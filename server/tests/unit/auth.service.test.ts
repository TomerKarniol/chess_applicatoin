import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/infrastructure/db/connection.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { UsersRepository } from '../../src/infrastructure/repositories/users.repository.js';
import { SessionsRepository } from '../../src/infrastructure/repositories/sessions.repository.js';
import { Argon2PasswordService } from '../../src/application/services/password.service.js';
import { AuthService } from '../../src/application/services/auth.service.js';
import { EnvAdminService } from '../../src/application/services/env-admin.service.js';
import { InvalidCredentialsError } from '../../src/shared/errors.js';

describe('AuthService', () => {
  let db: ReturnType<typeof openDb>;
  let usersRepo: UsersRepository;
  let sessionsRepo: SessionsRepository;
  let passwordService: Argon2PasswordService;
  let auth: AuthService;

  beforeEach(async () => {
    db = openDb(':memory:');
    runMigrations(db);
    usersRepo = new UsersRepository(db);
    sessionsRepo = new SessionsRepository(db);
    passwordService = new Argon2PasswordService();
    const envAdminService = new EnvAdminService({
      username: 'env-admin',
      password: undefined, // disabled — these tests focus on the DB path
      email: null,
      sessionTtlHours: 12,
    });
    auth = new AuthService({
      usersRepo,
      sessionsRepo,
      passwordService,
      envAdminService,
      sessionTtlDays: 30,
    });

    const passwordHash = await passwordService.hash('secret');
    usersRepo.create({ username: 'alice', passwordHash });
  });

  afterEach(() => {
    db.close();
  });

  it('returns a session on correct credentials', async () => {
    const { user, session } = await auth.login('alice', 'secret');
    expect(user.username).toBe('alice');
    expect(session.id).toMatch(/^[a-f0-9]{64}$/);
    expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects an unknown user with InvalidCredentialsError', async () => {
    await expect(auth.login('ghost', 'secret')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rejects a known user with the wrong password', async () => {
    await expect(auth.login('alice', 'nope')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rotates the session id on every successful login', async () => {
    const first = await auth.login('alice', 'secret');
    const second = await auth.login('alice', 'secret');
    expect(first.session.id).not.toBe(second.session.id);
    // first session should no longer resolve.
    expect(auth.resolveSession(first.session.id)).toBeNull();
    expect(auth.resolveSession(second.session.id)?.user.username).toBe('alice');
  });

  it('resolveSession returns null for empty / unknown ids', () => {
    expect(auth.resolveSession(null)).toBeNull();
    expect(auth.resolveSession(undefined)).toBeNull();
    expect(auth.resolveSession('not-a-session')).toBeNull();
  });

  it('logout removes the session row', async () => {
    const { session } = await auth.login('alice', 'secret');
    auth.logout(session.id);
    expect(auth.resolveSession(session.id)).toBeNull();
  });
});
