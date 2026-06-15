import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestStack, type TestStack } from '../helpers/test-app.js';
import { primeCsrf } from '../helpers/csrf.js';

async function loginAs(stack: TestStack, username: string, password: string) {
  const { token, cookieHeader } = await primeCsrf(stack.app);
  const res = await request(stack.app)
    .post('/api/v1/auth/login')
    .set('Cookie', cookieHeader)
    .set('X-CSRF-Token', token)
    .send({ username, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const set = res.headers['set-cookie'] as string[];
  const sidCookie = set.find(
    (c) =>
      (c.startsWith('chess_sid=') || c.startsWith('chess_admin_sid=')) &&
      !c.startsWith('chess_sid=;') &&
      !c.startsWith('chess_admin_sid=;'),
  )!;
  const sidValue = sidCookie.split(';')[0]!;
  return { token, cookies: `${cookieHeader}; ${sidValue}` };
}

describe('admin routes', () => {
  let stack: TestStack;
  beforeEach(async () => {
    stack = await buildTestStack();
  });
  afterEach(() => stack.closeDb());

  it('non-admin gets 403 on /admin/users', async () => {
    const tomer = await loginAs(stack, 'tomer', 'tomer');
    const res = await request(stack.app).get('/api/v1/admin/users').set('Cookie', tomer.cookies);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('admin can list users', async () => {
    const admin = await loginAs(stack, 'admin', 'admin123');
    const res = await request(stack.app).get('/api/v1/admin/users').set('Cookie', admin.cookies);
    expect(res.status).toBe(200);
    const usernames = (res.body.users as Array<{ username: string }>).map((u) => u.username).sort();
    // env-admin is NOT a DB row — only the seeded demo accounts are listed.
    expect(usernames).toEqual(['baruch', 'baruch_admin', 'tomer']);
  });

  it('admin can create a student, response includes a one-time temp password', async () => {
    const admin = await loginAs(stack, 'admin', 'admin123');
    const res = await request(stack.app)
      .post('/api/v1/admin/users')
      .set('Cookie', admin.cookies)
      .set('X-CSRF-Token', admin.token)
      .send({ username: 'newcomer' });
    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe('newcomer');
    expect(res.body.user.mustChangePassword).toBe(true);
    expect(res.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{12}$/);

    // Anonymous request without CSRF gets 403 csrf_failed (CSRF runs before auth).
    const anonNoCsrf = await request(stack.app).post('/api/v1/admin/users').send({ username: 'x' });
    expect(anonNoCsrf.status).toBe(403);
    expect(anonNoCsrf.body.error.code).toBe('csrf_failed');

    // With CSRF but no session → 401 unauthenticated.
    const { token, cookieHeader } = await primeCsrf(stack.app);
    const anon = await request(stack.app)
      .post('/api/v1/admin/users')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ username: 'x' });
    expect(anon.status).toBe(401);
  });

  it('regenerate-password kills existing sessions and re-flags the user', async () => {
    const admin = await loginAs(stack, 'admin', 'admin123');
    const create = await request(stack.app)
      .post('/api/v1/admin/users')
      .set('Cookie', admin.cookies)
      .set('X-CSRF-Token', admin.token)
      .send({ username: 'rotated' });
    const newId = create.body.user.id as number;

    const regen = await request(stack.app)
      .post(`/api/v1/admin/users/${newId}/regenerate-password`)
      .set('Cookie', admin.cookies)
      .set('X-CSRF-Token', admin.token);
    expect(regen.status).toBe(200);
    expect(regen.body.temporaryPassword).not.toBe(create.body.temporaryPassword);
    expect(regen.body.user.mustChangePassword).toBe(true);
  });
});
