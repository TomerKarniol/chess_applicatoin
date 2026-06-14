import { randomBytes } from 'node:crypto';
import { publicUser, type User } from '../../domain/user.js';
import { SESSION_ID_BYTES, type Session } from '../../domain/session.js';
import { InvalidCredentialsError } from '../../shared/errors.js';
import { addDays } from '../../shared/time.js';
import type { UsersRepository } from '../../infrastructure/repositories/users.repository.js';
import type { SessionsRepository } from '../../infrastructure/repositories/sessions.repository.js';
import type { PasswordService } from './password.service.js';
import { type EnvAdminService, type AdminSession } from './env-admin.service.js';

export interface AuthServiceDeps {
  usersRepo: UsersRepository;
  sessionsRepo: SessionsRepository;
  passwordService: PasswordService;
  envAdminService: EnvAdminService;
  sessionTtlDays: number;
}

/**
 * Pre-computed argon2 hash of an empty string, used to keep login latency
 * roughly constant for nonexistent usernames (defeats timing-based user
 * enumeration). Lazily initialized on first miss.
 */
let DUMMY_HASH: string | null = null;
async function getDummyHash(passwordService: PasswordService): Promise<string> {
  if (DUMMY_HASH) return DUMMY_HASH;
  DUMMY_HASH = await passwordService.hash('dummy-password-not-used');
  return DUMMY_HASH;
}

/**
 * Unified login outcome. The `kind` discriminator tells downstream code
 * whether to set the DB-session cookie or the env-admin cookie.
 */
export type LoginResult =
  | {
      kind: 'user';
      user: User;
      session: Session;
      mustChangePassword: boolean;
    }
  | {
      kind: 'admin';
      user: User;
      session: AdminSession;
      mustChangePassword: false;
    };

export type ResolvedSession =
  | { kind: 'user'; user: User; session: Session }
  | { kind: 'admin'; user: User; session: AdminSession };

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  /**
   * Login flow:
   *   1. If the env-admin path is enabled AND credentials match exactly,
   *      mint an in-memory admin session and return early.
   *   2. Otherwise verify against the users table as before.
   *
   * Step 1 runs before any DB work so a typo'd "admin" username never
   * touches the users repo.
   */
  async login(username: string, password: string): Promise<LoginResult> {
    if (this.deps.envAdminService.isEnabled()) {
      if (this.deps.envAdminService.verifyCredentials(username, password)) {
        const session = this.deps.envAdminService.createSession();
        return {
          kind: 'admin',
          user: this.deps.envAdminService.publicUser(),
          session,
          mustChangePassword: false,
        };
      }
    }

    const stored = this.deps.usersRepo.findByUsername(username);

    // Constant-ish work for the not-found path: still verify against a dummy
    // hash so attackers can't tell from response time whether the user exists.
    if (!stored) {
      await this.deps.passwordService.verify(password, await getDummyHash(this.deps.passwordService));
      throw new InvalidCredentialsError();
    }

    const ok = await this.deps.passwordService.verify(password, stored.passwordHash);
    if (!ok) throw new InvalidCredentialsError();

    // Session rotation: nuke any existing sessions for the user, mint a fresh one.
    this.deps.sessionsRepo.deleteByUserId(stored.id);

    const sessionId = randomBytes(SESSION_ID_BYTES).toString('hex');
    const expiresAt = addDays(new Date(), this.deps.sessionTtlDays).toISOString();
    const session = this.deps.sessionsRepo.create({
      id: sessionId,
      userId: stored.id,
      expiresAt,
    });

    return {
      kind: 'user',
      user: publicUser(stored),
      session,
      mustChangePassword: stored.mustChangePassword,
    };
  }

  logout(sessionId: string): void {
    this.deps.sessionsRepo.deleteById(sessionId);
  }

  logoutAdmin(sessionId: string): void {
    this.deps.envAdminService.destroySession(sessionId);
  }

  /**
   * Look up either kind of session. Used by `requireAuth` to populate
   * `req.auth` regardless of whether the caller is a DB user or env-admin.
   */
  resolveAnySession(
    userSessionId: string | undefined | null,
    adminSessionId: string | undefined | null,
  ): ResolvedSession | null {
    // Admin cookie wins over user cookie if both are present — the operator
    // explicitly chose to log in as admin, even from a browser that still
    // has a lingering user session cookie.
    if (adminSessionId) {
      const adminSession = this.deps.envAdminService.resolveSession(adminSessionId);
      if (adminSession) {
        return {
          kind: 'admin',
          user: this.deps.envAdminService.publicUser(),
          session: adminSession,
        };
      }
    }
    if (userSessionId) {
      const session = this.deps.sessionsRepo.findValidById(userSessionId);
      if (session) {
        const user = this.deps.usersRepo.findById(session.userId);
        if (user) return { kind: 'user', user, session };
      }
    }
    return null;
  }

  /**
   * Back-compat shim — older code only ever passed the DB session cookie.
   * Forwards to resolveAnySession with no admin cookie.
   */
  resolveSession(sessionId: string | undefined | null): { user: User; session: Session } | null {
    if (!sessionId) return null;
    const session = this.deps.sessionsRepo.findValidById(sessionId);
    if (!session) return null;
    const user = this.deps.usersRepo.findById(session.userId);
    if (!user) return null;
    return { user, session };
  }
}
