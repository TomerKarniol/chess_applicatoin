import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestStack, type TestStack } from '../helpers/test-app.js';
import { primeCsrf } from '../helpers/csrf.js';
import { ALL_MODULE_IDS } from '../../src/domain/progress.js';

/**
 * Helper: login a seeded user and return cookies + csrf token tied to the
 * session, ready for chaining additional requests.
 */
async function loginAs(stack: TestStack, username: string, password: string) {
  const { token, cookieHeader } = await primeCsrf(stack.app);
  const login = await request(stack.app)
    .post('/api/v1/auth/login')
    .set('Cookie', cookieHeader)
    .set('X-CSRF-Token', token)
    .send({ username, password });
  if (login.status !== 200) {
    throw new Error(`login failed for ${username}: ${login.status} ${JSON.stringify(login.body)}`);
  }
  const sidCookie = (login.headers['set-cookie'] as string[]).find((c) => c.startsWith('chess_sid='))!;
  const sidValue = sidCookie.split(';')[0]!;
  return {
    csrfToken: token,
    cookies: `${cookieHeader}; ${sidValue}`,
  };
}

describe('progress routes', () => {
  let stack: TestStack;

  beforeEach(async () => {
    stack = await buildTestStack();
  });

  afterEach(() => {
    stack.closeDb();
  });

  it('GET /progress requires auth', async () => {
    const res = await request(stack.app).get('/api/v1/progress');
    expect(res.status).toBe(401);
  });

  it('PUT /progress saves and GET /progress reads back', async () => {
    const { cookies, csrfToken } = await loginAs(stack, 'tomer', 'tomer');

    const put = await request(stack.app)
      .put('/api/v1/progress')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .send({
        completed: ['rook'],
        cards: ['rook'],
        modules: { rook: { stage1: { done: true } } },
        currentModule: 'bishop',
      });
    expect(put.status).toBe(204);

    const get = await request(stack.app).get('/api/v1/progress').set('Cookie', cookies);
    expect(get.status).toBe(200);
    expect(get.body).toEqual({
      completed: ['rook'],
      cards: ['rook'],
      modules: { rook: { stage1: { done: true } } },
      currentModule: 'bishop',
    });
  });

  it('progress is isolated between tomer and baruch', async () => {
    const tomer = await loginAs(stack, 'tomer', 'tomer');
    await request(stack.app)
      .put('/api/v1/progress')
      .set('Cookie', tomer.cookies)
      .set('X-CSRF-Token', tomer.csrfToken)
      .send({ completed: ['rook', 'bishop'], cards: [], modules: {}, currentModule: 'queen' });

    const baruch = await loginAs(stack, 'baruch', 'baruch');
    const baruchProgress = await request(stack.app)
      .get('/api/v1/progress')
      .set('Cookie', baruch.cookies);
    expect(baruchProgress.body.completed).toEqual([]);

    await request(stack.app)
      .put('/api/v1/progress')
      .set('Cookie', baruch.cookies)
      .set('X-CSRF-Token', baruch.csrfToken)
      .send({ completed: ['queen'], cards: [], modules: {}, currentModule: null });

    // Re-login as tomer to make sure his data is intact.
    const tomer2 = await loginAs(stack, 'tomer', 'tomer');
    const tomerProgress = await request(stack.app)
      .get('/api/v1/progress')
      .set('Cookie', tomer2.cookies);
    expect(tomerProgress.body.completed).toEqual(['rook', 'bishop']);
    expect(tomerProgress.body.currentModule).toBe('queen');
  });

  it('POST /progress/reset only resets the current user', async () => {
    const tomer = await loginAs(stack, 'tomer', 'tomer');
    await request(stack.app)
      .put('/api/v1/progress')
      .set('Cookie', tomer.cookies)
      .set('X-CSRF-Token', tomer.csrfToken)
      .send({ completed: ['rook'], cards: [], modules: {}, currentModule: null });

    const baruch = await loginAs(stack, 'baruch', 'baruch');
    await request(stack.app)
      .put('/api/v1/progress')
      .set('Cookie', baruch.cookies)
      .set('X-CSRF-Token', baruch.csrfToken)
      .send({ completed: ['queen'], cards: [], modules: {}, currentModule: null });

    // Re-login tomer so we have a non-rotated session for him.
    const tomer2 = await loginAs(stack, 'tomer', 'tomer');
    const reset = await request(stack.app)
      .post('/api/v1/progress/reset')
      .set('Cookie', tomer2.cookies)
      .set('X-CSRF-Token', tomer2.csrfToken);
    expect(reset.status).toBe(204);

    const tomerNow = await request(stack.app)
      .get('/api/v1/progress')
      .set('Cookie', tomer2.cookies);
    expect(tomerNow.body.completed).toEqual([]);

    // Re-login baruch and confirm his progress survived tomer's reset.
    const baruch2 = await loginAs(stack, 'baruch', 'baruch');
    const baruchNow = await request(stack.app)
      .get('/api/v1/progress')
      .set('Cookie', baruch2.cookies);
    expect(baruchNow.body.completed).toEqual(['queen']);
  });

  it('baruch_admin always sees every module unlocked, even after an empty snapshot is uploaded', async () => {
    // Simulate a device with stale/empty localStorage clobbering the stored row,
    // which is what made the account appear "locked" on other devices.
    const admin = await loginAs(stack, 'baruch_admin', 'baruch_admin');
    await request(stack.app)
      .put('/api/v1/progress')
      .set('Cookie', admin.cookies)
      .set('X-CSRF-Token', admin.csrfToken)
      .send({ completed: [], cards: [], modules: {}, currentModule: null });

    // A fresh login (any device) still gets the full set of completed modules.
    const fresh = await loginAs(stack, 'baruch_admin', 'baruch_admin');
    const res = await request(stack.app).get('/api/v1/progress').set('Cookie', fresh.cookies);
    expect(res.status).toBe(200);
    expect(res.body.completed).toEqual([...ALL_MODULE_IDS]);
  });

  it('PUT /progress validates the body', async () => {
    const { cookies, csrfToken } = await loginAs(stack, 'tomer', 'tomer');
    const res = await request(stack.app)
      .put('/api/v1/progress')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .send({ completed: 'not-an-array' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });
});
