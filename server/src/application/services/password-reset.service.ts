import { randomBytes, randomInt } from 'node:crypto';
import {
  RESET_CODE_DIGITS,
  RESET_SESSION_ID_BYTES,
  type ResetSession,
} from '../../domain/reset-code.js';
import { validateNewPassword, type UserWithSecret } from '../../domain/user.js';
import { AppError, ValidationError } from '../../shared/errors.js';
import { addDays, isPastIso, nowIso } from '../../shared/time.js';
import { childLogger } from '../../shared/logger.js';
import type { UsersRepository } from '../../infrastructure/repositories/users.repository.js';
import type { ResetCodesRepository } from '../../infrastructure/repositories/reset-codes.repository.js';
import type { ResetSessionsRepository } from '../../infrastructure/repositories/reset-sessions.repository.js';
import type { SessionsRepository } from '../../infrastructure/repositories/sessions.repository.js';
import type { PasswordService } from './password.service.js';
import type { EmailService } from './email.service.js';

const log = childLogger({ component: 'password-reset' });

export interface PasswordResetServiceDeps {
  usersRepo: UsersRepository;
  resetCodesRepo: ResetCodesRepository;
  resetSessionsRepo: ResetSessionsRepository;
  sessionsRepo: SessionsRepository;
  passwordService: PasswordService;
  emailService: EmailService;
  codeTtlMinutes: number;
  resetSessionTtlMinutes: number;
  maxAttempts: number;
  appPublicName: string;
}

export type InvalidResetReason =
  | 'no_request' // no active code for this account (never requested, or already consumed)
  | 'expired' // the code's TTL has passed
  | 'locked' // too many wrong attempts; the code is now burned
  | 'wrong_code'; // the code simply didn't match

export interface InvalidResetCode {
  outcome: 'invalid';
  reason: InvalidResetReason;
}

export interface VerifiedResetCode {
  outcome: 'verified';
  session: ResetSession;
}

export type VerifyResult = InvalidResetCode | VerifiedResetCode;

function addMinutesIso(minutes: number, now: Date = new Date()): string {
  const ms = now.getTime() + minutes * 60_000;
  return new Date(ms).toISOString();
}

function generateNumericCode(digits: number): string {
  const max = 10 ** digits;
  const n = randomInt(0, max);
  return n.toString().padStart(digits, '0');
}

type AccountResolution =
  | { kind: 'ok'; user: UserWithSecret }
  | { kind: 'none' } // no account matches the identifier
  | { kind: 'ambiguous' }; // an email shared by more than one account

export class PasswordResetService {
  constructor(private readonly deps: PasswordResetServiceDeps) {}

  /**
   * Resolve the account a reset request refers to. Usernames are unique and can
   * never contain '@' (see AdminService's username rule), so an identifier with
   * '@' is always an email lookup. Emails are NOT unique, so an email may match
   * zero, one, or several accounts — the caller decides what to do with each.
   */
  private resolveAccount(identifier: string): AccountResolution {
    if (identifier.includes('@')) {
      const matches = this.deps.usersRepo.findManyByEmail(identifier);
      if (matches.length === 0) return { kind: 'none' };
      if (matches.length > 1) return { kind: 'ambiguous' };
      return { kind: 'ok', user: matches[0]! };
    }
    const user = this.deps.usersRepo.findByUsername(identifier);
    return user ? { kind: 'ok', user } : { kind: 'none' };
  }

  /**
   * Begin a password reset. Validates the identifier and emails a code.
   *
   * Per product decision this flow reports clear errors (this is a small,
   * admin-managed app where usability beats anti-enumeration hardening):
   *   - 400 if the identifier is blank,
   *   - 404 if no account matches,
   *   - 409 if the account exists but has no email on file,
   *   - 502 if the email could not be sent.
   * The 5-requests / 15-minute rate limiter on the route blunts abuse.
   */
  async request(identifier: string): Promise<void> {
    const trimmed = identifier.trim();
    if (!trimmed) {
      throw new ValidationError(
        { field: 'identifier' },
        'Please enter your username or email.',
      );
    }

    const resolved = this.resolveAccount(trimmed);
    if (resolved.kind === 'none') {
      log.info('forgot-password: no matching user');
      throw new AppError({
        statusCode: 404,
        code: 'not_found',
        message: 'No account was found with that username or email.',
        details: { reason: 'user_not_found' },
      });
    }
    if (resolved.kind === 'ambiguous') {
      log.info('forgot-password: email shared by multiple accounts');
      throw new AppError({
        statusCode: 409,
        code: 'conflict',
        message:
          'That email is used by more than one account. Please enter your username instead.',
        details: { reason: 'email_ambiguous' },
      });
    }
    const user = resolved.user;
    if (!user.email) {
      log.info({ userId: user.id }, 'forgot-password: user has no email on file');
      throw new AppError({
        statusCode: 409,
        code: 'conflict',
        message:
          'This account has no email on file, so a reset code cannot be sent. Ask your teacher to reset the password for you.',
        details: { reason: 'no_email_on_file' },
      });
    }

    const code = generateNumericCode(RESET_CODE_DIGITS);
    const codeHash = await this.deps.passwordService.hash(code);
    const expiresAt = addMinutesIso(this.deps.codeTtlMinutes);
    this.deps.resetCodesRepo.create({ userId: user.id, codeHash, expiresAt });

    const subject = `קוד איפוס סיסמה - ${this.deps.appPublicName}`;
    const text =
      `שלום ${user.username},\n\n` +
      `קיבלת בקשה לאיפוס הסיסמה לחשבון שלך באפליקציית "${this.deps.appPublicName}".\n` +
      `קוד האיפוס שלך הוא: ${code}\n\n` +
      `הקוד תקף ל-${this.deps.codeTtlMinutes} דקות.\n` +
      `אם לא ביקשת לאפס את הסיסמה, אפשר להתעלם מההודעה הזו.\n`;
    const html =
      `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:16px;color:#0c1e30">` +
      `<p>שלום <b>${escapeHtml(user.username)}</b>,</p>` +
      `<p>קיבלת בקשה לאיפוס הסיסמה לחשבון שלך באפליקציית <b>${escapeHtml(this.deps.appPublicName)}</b>.</p>` +
      `<p style="font-size:24px;letter-spacing:.2em;font-weight:900;color:#c9a227">${code}</p>` +
      `<p>הקוד תקף ל-${this.deps.codeTtlMinutes} דקות.</p>` +
      `<p style="color:#6f8aab;font-size:13px">אם לא ביקשת לאפס את הסיסמה, אפשר להתעלם מההודעה הזו.</p>` +
      `</div>`;

    try {
      await this.deps.emailService.send({ to: user.email, subject, text, html });
      log.info({ userId: user.id, transport: this.deps.emailService.transportName }, 'reset code sent');
    } catch (err) {
      log.error({ err, userId: user.id }, 'failed to send reset email');
      throw new AppError({
        statusCode: 502,
        code: 'internal_error',
        message:
          'We could not send the reset email right now. Please try again in a few minutes.',
        details: { reason: 'email_send_failed' },
      });
    }
  }

  /**
   * Verify the user-supplied code. Returns `outcome:'verified'` plus a
   * short-lived reset session on success, otherwise `outcome:'invalid'`.
   * Note: this method is intentionally chatty in the logs but returns a
   * sanitized shape so callers can't accidentally leak details.
   */
  async verify(identifier: string, code: string): Promise<VerifyResult> {
    const cleanIdentifier = identifier.trim();
    const cleanCode = code.trim();
    if (!cleanIdentifier || !/^\d{1,12}$/.test(cleanCode)) {
      return { outcome: 'invalid', reason: 'wrong_code' };
    }
    // A non-unique email can't single out an account; such users must verify by
    // username (forgot-password already told them so). Treat anything that
    // doesn't resolve to exactly one account as "no active request".
    const resolved = this.resolveAccount(cleanIdentifier);
    if (resolved.kind !== 'ok') return { outcome: 'invalid', reason: 'no_request' };
    const user = resolved.user;

    const record = this.deps.resetCodesRepo.findLatestActiveForUser(user.id);
    // No outstanding code, or the latest one was already consumed → nothing to verify.
    if (!record || record.usedAt) return { outcome: 'invalid', reason: 'no_request' };
    if (isPastIso(record.expiresAt)) return { outcome: 'invalid', reason: 'expired' };
    if (record.attempts >= this.deps.maxAttempts) {
      // Already locked out. Burn it so it can't keep matching, and say so.
      this.deps.resetCodesRepo.markUsed(record.id);
      return { outcome: 'invalid', reason: 'locked' };
    }

    const ok = await this.deps.passwordService.verify(cleanCode, record.codeHash);
    if (!ok) {
      const next = this.deps.resetCodesRepo.incrementAttempts(record.id);
      if (next >= this.deps.maxAttempts) {
        // That was the final allowed attempt — burn the code and tell them.
        this.deps.resetCodesRepo.markUsed(record.id);
        return { outcome: 'invalid', reason: 'locked' };
      }
      return { outcome: 'invalid', reason: 'wrong_code' };
    }

    this.deps.resetCodesRepo.markVerified(record.id);

    // Mint a short-lived reset session — the cookie this returns proves to
    // the next request that THIS browser has verified THIS code.
    const sid = randomBytes(RESET_SESSION_ID_BYTES).toString('hex');
    const expiresAt = addMinutesIso(this.deps.resetSessionTtlMinutes);
    const session = this.deps.resetSessionsRepo.create({
      id: sid,
      userId: user.id,
      codeId: record.id,
      expiresAt,
    });
    return { outcome: 'verified', session };
  }

  /**
   * Consume a verified reset session and swap the user's password.
   * Throws on validation failures so the HTTP layer can map to 400s.
   */
  async reset(resetSessionId: string, newPassword: string, confirmPassword: string): Promise<void> {
    const session = this.deps.resetSessionsRepo.findValidById(resetSessionId);
    if (!session) {
      throw new AppError({
        statusCode: 401,
        code: 'unauthenticated',
        message: 'Reset session is missing or expired. Please request a new reset code.',
      });
    }

    if (newPassword !== confirmPassword) {
      throw new ValidationError({ field: 'confirmPassword' }, 'Passwords do not match.');
    }
    const violation = validateNewPassword(newPassword);
    if (violation) {
      throw new ValidationError({ field: 'newPassword', code: violation.code }, violation.message);
    }

    const code = this.deps.resetCodesRepo.findById(session.codeId);
    if (!code || code.usedAt || isPastIso(code.expiresAt) || !code.verifiedAt) {
      this.deps.resetSessionsRepo.deleteById(session.id);
      throw new AppError({
        statusCode: 401,
        code: 'unauthenticated',
        message: 'Reset code is no longer valid. Please request a new one.',
      });
    }

    const passwordHash = await this.deps.passwordService.hash(newPassword);
    const now = nowIso();
    this.deps.usersRepo.updateSecret(session.userId, {
      passwordHash,
      passwordUpdatedAt: now,
      // The user is choosing a real password; clear any first-time flag.
      mustChangePassword: false,
      temporaryPasswordCreatedAt: null,
    });

    // Clean up: consume the code and the reset session, and wipe any
    // outstanding login sessions so old devices are forcibly logged out.
    this.deps.resetCodesRepo.markUsed(code.id);
    this.deps.resetSessionsRepo.deleteByUserId(session.userId);
    this.deps.sessionsRepo.deleteByUserId(session.userId);

    log.info({ userId: session.userId }, 'password reset succeeded');
  }

  /** Periodic housekeeping: drop expired codes + reset sessions. */
  pruneExpired(now: Date = new Date()): { codes: number; sessions: number } {
    return {
      codes: this.deps.resetCodesRepo.deleteExpired(now),
      sessions: this.deps.resetSessionsRepo.deleteExpired(now),
    };
  }

  // Exposed for tests/diagnostics — kept on the service so it stays close to the policy.
  static codeLifetimeFromDays(days: number): Date {
    return addDays(new Date(), days);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
