import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/infrastructure/db/connection.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { UsersRepository } from '../../src/infrastructure/repositories/users.repository.js';
import { SessionsRepository } from '../../src/infrastructure/repositories/sessions.repository.js';
import { Argon2PasswordService } from '../../src/application/services/password.service.js';
import { AdminService } from '../../src/application/services/admin.service.js';
import { ConflictError, ValidationError } from '../../src/shared/errors.js';

describe('AdminService', () => {
  let db: ReturnType<typeof openDb>;
  let usersRepo: UsersRepository;
  let sessionsRepo: SessionsRepository;
  let passwordService: Argon2PasswordService;
  let svc: AdminService;

  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
    usersRepo = new UsersRepository(db);
    sessionsRepo = new SessionsRepository(db);
    passwordService = new Argon2PasswordService();
    svc = new AdminService({ usersRepo, sessionsRepo, passwordService });
  });

  afterEach(() => {
    db.close();
  });

  it('createStudent persists the user with must_change_password=1 and returns the temp password', async () => {
    const result = await svc.createStudent('newbie');
    expect(result.user.username).toBe('newbie');
    expect(result.user.mustChangePassword).toBe(true);
    expect(result.temporaryPassword).toMatch(/^[A-Za-z0-9]{12}$/);

    const stored = usersRepo.findByUsername('newbie')!;
    expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(await passwordService.verify(result.temporaryPassword, stored.passwordHash)).toBe(true);
    // Temp password should NOT match the username — sanity for the generator.
    expect(result.temporaryPassword).not.toBe('newbie');
  });

  it('rejects an invalid username', async () => {
    await expect(svc.createStudent('bad spaces')).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.createStudent('')).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a duplicate username with ConflictError', async () => {
    await svc.createStudent('dupe');
    await expect(svc.createStudent('dupe')).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.createStudent('DUPE')).rejects.toBeInstanceOf(ConflictError);
  });

  it('regenerateTempPassword kills sessions and re-flags must_change_password', async () => {
    const { user } = await svc.createStudent('rotater');
    sessionsRepo.create({
      id: 'sess',
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const result = await svc.regenerateTempPassword(user.id);
    expect(result.user.mustChangePassword).toBe(true);
    expect(result.temporaryPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(sessionsRepo.findValidById('sess')).toBeNull();
  });

  it('regenerateTempPassword refuses admin accounts', async () => {
    const adminUser = usersRepo.create({
      username: 'rootlike',
      passwordHash: await passwordService.hash('x'),
      isAdmin: true,
    });
    await expect(svc.regenerateTempPassword(adminUser.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it('listUsers returns every user including admins', async () => {
    await svc.createStudent('a');
    await svc.createStudent('b');
    expect(svc.listUsers().map((u) => u.username).sort()).toEqual(['a', 'b']);
  });
});
