import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/infrastructure/db/connection.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { UsersRepository } from '../../src/infrastructure/repositories/users.repository.js';
import { SessionsRepository } from '../../src/infrastructure/repositories/sessions.repository.js';
import { ResetCodesRepository } from '../../src/infrastructure/repositories/reset-codes.repository.js';
import { ResetSessionsRepository } from '../../src/infrastructure/repositories/reset-sessions.repository.js';
import { Argon2PasswordService } from '../../src/application/services/password.service.js';
import { PasswordResetService } from '../../src/application/services/password-reset.service.js';
import { ValidationError } from '../../src/shared/errors.js';
import { CapturingEmailService } from '../helpers/test-app.js';

describe('PasswordResetService', () => {
  let db: ReturnType<typeof openDb>;
  let usersRepo: UsersRepository;
  let sessionsRepo: SessionsRepository;
  let resetCodesRepo: ResetCodesRepository;
  let resetSessionsRepo: ResetSessionsRepository;
  let passwordService: Argon2PasswordService;
  let email: CapturingEmailService;
  let svc: PasswordResetService;

  beforeEach(async () => {
    db = openDb(':memory:');
    runMigrations(db);
    usersRepo = new UsersRepository(db);
    sessionsRepo = new SessionsRepository(db);
    resetCodesRepo = new ResetCodesRepository(db);
    resetSessionsRepo = new ResetSessionsRepository(db);
    passwordService = new Argon2PasswordService();
    email = new CapturingEmailService();
    svc = new PasswordResetService({
      usersRepo,
      sessionsRepo,
      resetCodesRepo,
      resetSessionsRepo,
      passwordService,
      emailService: email,
      codeTtlMinutes: 15,
      resetSessionTtlMinutes: 5,
      maxAttempts: 3,
      appPublicName: 'אני מפלצת שחמט!',
    });
    usersRepo.create({
      username: 'student',
      passwordHash: await passwordService.hash('OldPass1'),
      email: 'student@example.com',
    });
  });

  afterEach(() => {
    db.close();
  });

  it('request throws 404 for an unknown identifier and sends nothing', async () => {
    await expect(svc.request('ghost')).rejects.toMatchObject({
      statusCode: 404,
      details: { reason: 'user_not_found' },
    });
    expect(email.sent).toHaveLength(0);
  });

  it('request throws 409 for a known user without an email on file', async () => {
    usersRepo.create({ username: 'noemail', passwordHash: 'x' });
    await expect(svc.request('noemail')).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'no_email_on_file' },
    });
    expect(email.sent).toHaveLength(0);
  });

  it('request throws 400 for a blank identifier', async () => {
    await expect(svc.request('   ')).rejects.toBeInstanceOf(ValidationError);
    expect(email.sent).toHaveLength(0);
  });

  it('request surfaces a 502 when the email transport fails', async () => {
    const svcBoom = new PasswordResetService({
      usersRepo,
      sessionsRepo,
      resetCodesRepo,
      resetSessionsRepo,
      passwordService,
      emailService: {
        transportName: 'boom',
        verify: () => Promise.resolve(),
        send: () => Promise.reject(new Error('ENOTFOUND smpt.gmail.com')),
      },
      codeTtlMinutes: 15,
      resetSessionTtlMinutes: 5,
      maxAttempts: 3,
      appPublicName: 'אני מפלצת שחמט!',
    });
    await expect(svcBoom.request('student')).rejects.toMatchObject({
      statusCode: 502,
      details: { reason: 'email_send_failed' },
    });
  });

  it('request sends an email containing a 6-digit code for a known user', async () => {
    await svc.request('student');
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toBe('student@example.com');
    expect(email.lastCode()).toMatch(/^\d{6}$/);
  });

  it('verify accepts the correct code and returns a reset session', async () => {
    await svc.request('student');
    const code = email.lastCode()!;
    const result = await svc.verify('student', code);
    expect(result.outcome).toBe('verified');
    if (result.outcome === 'verified') {
      expect(result.session.id).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('verify rejects a wrong code and counts the attempt', async () => {
    await svc.request('student');
    const r1 = await svc.verify('student', '000000');
    expect(r1.outcome).toBe('invalid');
    const reloaded = resetCodesRepo.findLatestActiveForUser(usersRepo.findByUsername('student')!.id);
    expect(reloaded?.attempts).toBe(1);
  });

  it('verify locks out after maxAttempts wrong codes', async () => {
    await svc.request('student');
    for (let i = 0; i < 3; i++) await svc.verify('student', '000000');
    // Even the right code should now be rejected.
    const real = email.lastCode()!;
    const final = await svc.verify('student', real);
    expect(final.outcome).toBe('invalid');
  });

  it('reset updates the password, marks the code used, and invalidates active sessions', async () => {
    const student = usersRepo.findByUsername('student')!;
    // Create a regular login session for the student so we can verify it gets killed.
    sessionsRepo.create({
      id: 'existing',
      userId: student.id,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await svc.request('student');
    const code = email.lastCode()!;
    const v = await svc.verify('student', code);
    if (v.outcome !== 'verified') throw new Error('expected verified');

    await svc.reset(v.session.id, 'BrandNew1', 'BrandNew1');

    const reloaded = usersRepo.findByUsername('student')!;
    expect(await passwordService.verify('BrandNew1', reloaded.passwordHash)).toBe(true);
    expect(await passwordService.verify('OldPass1', reloaded.passwordHash)).toBe(false);
    expect(sessionsRepo.findValidById('existing')).toBeNull();
  });

  it('reset rejects mismatched / weak passwords', async () => {
    await svc.request('student');
    const code = email.lastCode()!;
    const v = await svc.verify('student', code);
    if (v.outcome !== 'verified') throw new Error('expected verified');
    await expect(svc.reset(v.session.id, 'Aa11aa', 'Aa11aB')).rejects.toBeInstanceOf(ValidationError);
  });
});
