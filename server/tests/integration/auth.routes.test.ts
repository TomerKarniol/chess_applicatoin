import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestStack, type TestStack } from '../helpers/test-app.js';
import { primeCsrf } from '../helpers/csrf.js';

describe('POST /api/v1/auth/login + /me + /logout', () => {
  let stack: TestStack;

  beforeEach(async () => {
    stack = await buildTestStack();
  });

  afterEach(() => {
    stack.closeDb();
  });

  it('rejects login without a CSRF token (403)', async () => {
    const res = await request(stack.app)
      .post('/api/v1/auth/login')
      .send({ username: 'tomer', password: 'tomer' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf_failed');
  });

  it('logs in tomer/tomer and sets an HttpOnly session cookie', async () => {
    const { token, cookieHeader } = await primeCsrf(stack.app);
    const res = await request(stack.app)
      .post('/api/v1/auth/login')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ username: 'tomer', password: 'tomer' });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('tomer');

    const setCookie = res.headers['set-cookie'] as string[] | undefined;
    expect(setCookie).toBeDefined();
    const sid = setCookie?.find((c) => c.startsWith('chess_sid='));
    expect(sid).toBeDefined();
    expect(sid).toMatch(/HttpOnly/i);
    expect(sid).toMatch(/SameSite=Lax/i);
  });

  it('rejects bad credentials (401)', async () => {
    const { token, cookieHeader } = await primeCsrf(stack.app);
    const res = await request(stack.app)
      .post('/api/v1/auth/login')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ username: 'tomer', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
  });

  it('GET /me requires a valid session cookie (401 otherwise)', async () => {
    const anon = await request(stack.app).get('/api/v1/auth/me');
    expect(anon.status).toBe(401);
  });

  it('full login → me → logout → me cycle', async () => {
    const { token, cookieHeader } = await primeCsrf(stack.app);
    const login = await request(stack.app)
      .post('/api/v1/auth/login')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ username: 'baruch', password: 'baruch' });
    expect(login.status).toBe(200);

    const sid = (login.headers['set-cookie'] as string[]).find((c) => c.startsWith('chess_sid='))!;
    const sidValue = sid.split(';')[0]!;
    const cookies = `${cookieHeader}; ${sidValue}`;

    const me = await request(stack.app).get('/api/v1/auth/me').set('Cookie', cookies);
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('baruch');

    const logout = await request(stack.app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', token);
    expect(logout.status).toBe(204);

    const after = await request(stack.app).get('/api/v1/auth/me').set('Cookie', cookies);
    expect(after.status).toBe(401);
  });

  it('validates the login body', async () => {
    const { token, cookieHeader } = await primeCsrf(stack.app);
    const res = await request(stack.app)
      .post('/api/v1/auth/login')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ username: '', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });
});

describe('login rate limiting', () => {
  let closeDb: (() => void) | null = null;

  afterEach(() => {
    closeDb?.();
    closeDb = null;
  });

  it('returns 429 after exceeding LOGIN_RATE_LIMIT_MAX', async () => {
    const stack = await buildTestStack({
      envOverrides: { LOGIN_RATE_LIMIT_MAX: 2 },
    });
    closeDb = () => stack.closeDb();
    const app = stack.app;
    const { token, cookieHeader } = await primeCsrf(app);

    const fire = () =>
      request(app)
        .post('/api/v1/auth/login')
        .set('Cookie', cookieHeader)
        .set('X-CSRF-Token', token)
        .send({ username: 'tomer', password: 'wrong' });

    const r1 = await fire();
    const r2 = await fire();
    const r3 = await fire();
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    expect(r3.status).toBe(429);
    expect(r3.body.error.code).toBe('rate_limited');
  });
});
