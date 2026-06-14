import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { User } from '../../domain/user.js';

/**
 * Sentinel id used in `User` records for the env-admin. Negative so it can
 * never collide with a real SQLite AUTOINCREMENT id (which start at 1).
 */
export const ENV_ADMIN_USER_ID = -1;

export const ADMIN_SESSION_COOKIE_NAME = 'chess_admin_sid';
const ADMIN_SESSION_ID_BYTES = 32;

export interface AdminSession {
  readonly id: string;
  readonly username: string;
  /** ms-since-epoch */
  readonly expiresAt: number;
}

export interface EnvAdminServiceDeps {
  username: string;
  password: string | undefined;
  email: string | null;
  sessionTtlHours: number;
}

/**
 * Authenticates the single operator admin against credentials held in the
 * environment (NOT the database). On success a short-lived session id is
 * issued and held in memory; cleared on server restart, which is the
 * intended cost of rotating admin credentials.
 *
 * If `ADMIN_PASSWORD` is empty / unset, this service is *disabled*: every
 * verify call returns false. The login path then falls through to normal
 * DB-based auth — letting an operator deliberately turn off env-admin by
 * leaving the password blank.
 */
export class EnvAdminService {
  private readonly sessions = new Map<string, number /* expiresAt ms */>();
  private readonly passwordBuffer: Buffer | null;

  constructor(private readonly deps: EnvAdminServiceDeps) {
    this.passwordBuffer = deps.password ? Buffer.from(deps.password, 'utf8') : null;
  }

  /** True iff the env-admin path is configured (password present). */
  isEnabled(): boolean {
    return this.passwordBuffer !== null;
  }

  /**
   * Constant-time credential check. Returns false unless both the username
   * matches (case-insensitive, like the DB user lookup) AND the password
   * matches the env value. Never throws.
   */
  verifyCredentials(username: string, password: string): boolean {
    if (!this.passwordBuffer) return false;
    const u = (username ?? '').trim();
    const usernameMatches = u.toLowerCase() === this.deps.username.toLowerCase();

    // Always perform the timing-safe compare, even on a username mismatch,
    // so an attacker can't probe usernames via timing.
    const candidate = Buffer.from(password ?? '', 'utf8');
    const a = candidate.length === this.passwordBuffer.length
      ? candidate
      : Buffer.alloc(this.passwordBuffer.length);
    const passwordMatches =
      candidate.length === this.passwordBuffer.length && timingSafeEqual(a, this.passwordBuffer);

    return usernameMatches && passwordMatches;
  }

  /** Mint a new session id and remember it in-memory. */
  createSession(): AdminSession {
    const id = randomBytes(ADMIN_SESSION_ID_BYTES).toString('hex');
    const expiresAt = Date.now() + this.deps.sessionTtlHours * 60 * 60 * 1000;
    this.sessions.set(id, expiresAt);
    return { id, username: this.deps.username, expiresAt };
  }

  /** Returns the session if it exists and hasn't expired. */
  resolveSession(id: string | undefined | null): AdminSession | null {
    if (!id) return null;
    const expiresAt = this.sessions.get(id);
    if (expiresAt === undefined) return null;
    if (expiresAt <= Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    return { id, username: this.deps.username, expiresAt };
  }

  destroySession(id: string | undefined | null): void {
    if (id) this.sessions.delete(id);
  }

  /** Sweep expired sessions periodically; safe to call on a timer. */
  pruneExpired(now: number = Date.now()): number {
    let removed = 0;
    for (const [id, exp] of this.sessions) {
      if (exp <= now) {
        this.sessions.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /**
   * The synthetic User shape returned by /auth/me and /auth/login when the
   * caller is the env-admin. The id is the sentinel ENV_ADMIN_USER_ID, which
   * downstream code must treat specially (no progress, no DB lookup).
   */
  publicUser(): User {
    return {
      id: ENV_ADMIN_USER_ID,
      username: this.deps.username,
      email: this.deps.email,
      isAdmin: true,
      mustChangePassword: false,
      createdAt: '1970-01-01T00:00:00Z',
      passwordUpdatedAt: null,
      temporaryPasswordCreatedAt: null,
    };
  }

  /**
   * True iff the id corresponds to the synthetic env-admin user (used by
   * other services to refuse operations that don't make sense for admin —
   * e.g. saving "admin's" chess progress).
   */
  static isEnvAdminUserId(id: number): boolean {
    return id === ENV_ADMIN_USER_ID;
  }
}
