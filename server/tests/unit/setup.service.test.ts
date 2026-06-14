import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/infrastructure/db/connection.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { UsersRepository } from '../../src/infrastructure/repositories/users.repository.js';
import { Argon2PasswordService } from '../../src/application/services/password.service.js';
import { SetupService } from '../../src/application/services/setup.service.js';
import { ValidationError } from '../../src/shared/errors.js';

describe('SetupService.completeFirstTimeSetup', () => {
  let db: ReturnType<typeof openDb>;
  let usersRepo: UsersRepository;
  let passwordService: Argon2PasswordService;
  let svc: SetupService;

  beforeEach(async () => {
    db = openDb(':memory:');
    runMigrations(db);
    usersRepo = new UsersRepository(db);
    passwordService = new Argon2PasswordService();
    svc = new SetupService({ usersRepo, passwordService });
    usersRepo.create({
      username: 'student',
      passwordHash: await passwordService.hash('TempPass1'),
      mustChangePassword: true,
    });
  });

  afterEach(() => {
    db.close();
  });

  function userId(): number {
    return usersRepo.findByUsername('student')!.id;
  }

  it('rejects mismatched passwords', async () => {
    await expect(
      svc.completeFirstTimeSetup(userId(), {
        email: 'a@b.co',
        newPassword: 'Real1234',
        confirmPassword: 'Real1235',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an invalid email', async () => {
    await expect(
      svc.completeFirstTimeSetup(userId(), {
        email: 'not-an-email',
        newPassword: 'Real1234',
        confirmPassword: 'Real1234',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a password missing a digit (policy: 6+ chars, letter+digit)', async () => {
    await expect(
      svc.completeFirstTimeSetup(userId(), {
        email: 'a@b.co',
        newPassword: 'AllLettersHere',
        confirmPassword: 'AllLettersHere',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a password shorter than 6 chars', async () => {
    await expect(
      svc.completeFirstTimeSetup(userId(), {
        email: 'a@b.co',
        newPassword: 'ab12',
        confirmPassword: 'ab12',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('allows an email already used by another account (emails are not unique)', async () => {
    usersRepo.create({ username: 'other', passwordHash: 'x', email: 'shared@a.co' });
    const user = await svc.completeFirstTimeSetup(userId(), {
      email: 'shared@a.co',
      newPassword: 'Real1234',
      confirmPassword: 'Real1234',
    });
    expect(user.email).toBe('shared@a.co');
  });

  it('clears must_change_password and stores the new email + hashed password', async () => {
    const user = await svc.completeFirstTimeSetup(userId(), {
      email: 'Student@Example.Com',
      newPassword: 'Real1234',
      confirmPassword: 'Real1234',
    });
    expect(user.email).toBe('student@example.com'); // normalized to lowercase
    expect(user.mustChangePassword).toBe(false);

    const stored = usersRepo.findByUsername('student')!;
    expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(await passwordService.verify('Real1234', stored.passwordHash)).toBe(true);
  });
});
