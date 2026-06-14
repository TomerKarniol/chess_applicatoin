import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestStack, type TestStack } from '../helpers/test-app.js';
import { primeCsrf } from '../helpers/csrf.js';

/**
 * Full forgot-password → verify-reset-code → reset-password sequence.
 */
describe('password reset flow', () => {
  let stack: TestStack;

  beforeEach(async () => {
    stack = await buildTestStack();
    // The env-admin can't use the password reset flow (no DB row, no email
    // recovery path) — use the seeded tomer demo account instead. We give him
    // an email up front so forgot-password has something to send to.
    stack.usersRepo.updateEmail(
      stack.usersRepo.findByUsername('tomer')!.id,
      'tomer@chess.test',
    );
  });

  afterEach(() => {
    stack.closeDb();
  });

  it('forgot-password returns 404 for an unknown identifier', async () => {
    const { token, cookieHeader } = await primeCsrf(stack.app);
    const res = await request(stack.app)
      .post('/api/v1/auth/forgot-password')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ identifier: 'ghostly-user' });
    expect(res.status).toBe(404);
    expect(res.body.error.details?.reason).toBe('user_not_found');
    expect(stack.emailService.sent).toHaveLength(0);
  });

  it('forgot-password returns 409 when the account has no email on file', async () => {
    const { token, cookieHeader } = await primeCsrf(stack.app);
    stack.usersRepo.create({ username: 'noemail', passwordHash: 'x' });
    const res = await request(stack.app)
      .post('/api/v1/auth/forgot-password')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ identifier: 'noemail' });
    expect(res.status).toBe(409);
    expect(res.body.error.details?.reason).toBe('no_email_on_file');
    expect(stack.emailService.sent).toHaveLength(0);
  });

  it('forgot-password returns 409 when an email is shared by multiple accounts', async () => {
    const { token, cookieHeader } = await primeCsrf(stack.app);
    // tomer already owns tomer@chess.test; give a second account the same email.
    const sibling = stack.usersRepo.create({ username: 'sibling', passwordHash: 'x' });
    stack.usersRepo.updateEmail(sibling.id, 'tomer@chess.test');

    const byEmail = await request(stack.app)
      .post('/api/v1/auth/forgot-password')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ identifier: 'tomer@chess.test' });
    expect(byEmail.status).toBe(409);
    expect(byEmail.body.error.details?.reason).toBe('email_ambiguous');
    expect(stack.emailService.sent).toHaveLength(0);

    // But each account can still reset via its unique username; the code is
    // sent to the shared address.
    const byUsername = await request(stack.app)
      .post('/api/v1/auth/forgot-password')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ identifier: 'sibling' });
    expect(byUsername.status).toBe(204);
    expect(stack.emailService.sent).toHaveLength(1);
    expect(stack.emailService.sent[0]!.to).toBe('tomer@chess.test');
  });

  it('forgot-password returns 204 and sends an email for a known identifier', async () => {
    const { token, cookieHeader } = await primeCsrf(stack.app);
    const res = await request(stack.app)
      .post('/api/v1/auth/forgot-password')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ identifier: 'tomer' });
    expect(res.status).toBe(204);
    expect(stack.emailService.sent).toHaveLength(1);
    expect(stack.emailService.lastCode()).toMatch(/^\d{6}$/);
  });

  it('full happy path: request → verify → reset → log in with new password', async () => {
    const { token, cookieHeader } = await primeCsrf(stack.app);

    await request(stack.app)
      .post('/api/v1/auth/forgot-password')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ identifier: 'tomer@chess.test' }); // try via email this time
    const code = stack.emailService.lastCode()!;

    const verify = await request(stack.app)
      .post('/api/v1/auth/verify-reset-code')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ identifier: 'tomer', code });
    expect(verify.status).toBe(200);
    const resetCookie = (verify.headers['set-cookie'] as string[]).find((c) =>
      c.startsWith('chess_reset_sid='),
    )!;
    const cookies = `${cookieHeader}; ${resetCookie.split(';')[0]}`;

    const reset = await request(stack.app)
      .post('/api/v1/auth/reset-password')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', token)
      .send({ newPassword: 'FreshPass1', confirmPassword: 'FreshPass1' });
    expect(reset.status).toBe(204);

    // Old password fails:
    const stale = await request(stack.app)
      .post('/api/v1/auth/login')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ username: 'tomer', password: 'tomer' });
    expect(stale.status).toBe(401);

    const login = await request(stack.app)
      .post('/api/v1/auth/login')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ username: 'tomer', password: 'FreshPass1' });
    expect(login.status).toBe(200);
    // Reset clears must_change_password too — the user proved ownership.
    expect(login.body.mustChangePassword).toBe(false);
  });

  it('verify-reset-code returns 400 for a wrong code', async () => {
    const { token, cookieHeader } = await primeCsrf(stack.app);
    await request(stack.app)
      .post('/api/v1/auth/forgot-password')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ identifier: 'tomer' });
    const res = await request(stack.app)
      .post('/api/v1/auth/verify-reset-code')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ identifier: 'tomer', code: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.error.details?.reason).toBe('invalid_code');
  });

  it('verify-reset-code returns 429 after too many wrong attempts', async () => {
    const { token, cookieHeader } = await primeCsrf(stack.app);
    await request(stack.app)
      .post('/api/v1/auth/forgot-password')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ identifier: 'tomer' });

    // maxAttempts is 5 in the test stack; the 5th wrong attempt burns the code.
    const wrong = () =>
      request(stack.app)
        .post('/api/v1/auth/verify-reset-code')
        .set('Cookie', cookieHeader)
        .set('X-CSRF-Token', token)
        .send({ identifier: 'tomer', code: '000000' });
    for (let i = 0; i < 4; i++) await wrong();
    const last = await wrong();
    expect(last.status).toBe(429);
    expect(last.body.error.details?.reason).toBe('too_many_attempts');
  });

  it('verify-reset-code returns 400 when no reset was requested', async () => {
    const { token, cookieHeader } = await primeCsrf(stack.app);
    const res = await request(stack.app)
      .post('/api/v1/auth/verify-reset-code')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ identifier: 'tomer', code: '123456' });
    expect(res.status).toBe(400);
    expect(res.body.error.details?.reason).toBe('no_active_request');
  });

  it('reset-password fails without a reset cookie', async () => {
    const { token, cookieHeader } = await primeCsrf(stack.app);
    const res = await request(stack.app)
      .post('/api/v1/auth/reset-password')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ newPassword: 'FreshPass1', confirmPassword: 'FreshPass1' });
    expect(res.status).toBe(401);
  });
});
