import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestStack, type TestStack } from '../helpers/test-app.js';
import { primeCsrf } from '../helpers/csrf.js';

/**
 * Full first-time-login → setup → progress sequence. Drives the HTTP
 * surface end-to-end via supertest so the gating + cookies + cross-route
 * interaction are exercised together.
 */
describe('first-time setup flow', () => {
  let stack: TestStack;

  beforeEach(async () => {
    stack = await buildTestStack();
  });

  afterEach(() => {
    stack.closeDb();
  });

  async function withCsrf() {
    return primeCsrf(stack.app);
  }

  async function loginAs(username: string, password: string) {
    const { token, cookieHeader } = await withCsrf();
    const res = await request(stack.app)
      .post('/api/v1/auth/login')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ username, password });
    if (res.status !== 200) {
      throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    const setCookies = res.headers['set-cookie'] as string[];
    const sidCookie = setCookies.find(
      (c) => c.startsWith('chess_sid=') || c.startsWith('chess_admin_sid='),
    );
    if (!sidCookie || sidCookie.startsWith('chess_sid=;') || sidCookie.startsWith('chess_admin_sid=;')) {
      throw new Error(`no session cookie in login response: ${JSON.stringify(setCookies)}`);
    }
    const sidValue = sidCookie.split(';')[0]!;
    return {
      token,
      cookies: `${cookieHeader}; ${sidValue}`,
      mustChangePassword: res.body.mustChangePassword as boolean,
      user: res.body.user,
    };
  }

  async function createStudent(adminCookies: string, adminCsrf: string, username: string) {
    const res = await request(stack.app)
      .post('/api/v1/admin/users')
      .set('Cookie', adminCookies)
      .set('X-CSRF-Token', adminCsrf)
      .send({ username });
    expect(res.status).toBe(201);
    return res.body.temporaryPassword as string;
  }

  it('admin creates a student → student must change password → setup unlocks progress', async () => {
    // ── Step 1: log in as the env-admin (no DB row, no setup needed) and create the student. ──
    const admin = await loginAs('admin', 'admin123');
    expect(admin.mustChangePassword).toBe(false);
    expect(admin.user.isAdmin).toBe(true);
    // The env-admin can NOT use /auth/complete-setup — they have no DB row.
    const adminSetupAttempt = await request(stack.app)
      .post('/api/v1/auth/complete-setup')
      .set('Cookie', admin.cookies)
      .set('X-CSRF-Token', admin.token)
      .send({
        email: 'owner@chess-app.test',
        newPassword: 'OwnerPass1',
        confirmPassword: 'OwnerPass1',
      });
    expect(adminSetupAttempt.status).toBe(400);

    const tempPwd = await createStudent(admin.cookies, admin.token, 'student1');

    // ── Step 2: student logs in with temp password. ──
    const student = await loginAs('student1', tempPwd);
    expect(student.mustChangePassword).toBe(true);

    // ── Step 3: progress endpoint is gated. ──
    const blocked = await request(stack.app)
      .get('/api/v1/progress')
      .set('Cookie', student.cookies);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('forbidden');
    expect(blocked.body.error.details?.reason).toBe('setup_required');

    // ── Step 4: student completes setup. ──
    const setup = await request(stack.app)
      .post('/api/v1/auth/complete-setup')
      .set('Cookie', student.cookies)
      .set('X-CSRF-Token', student.token)
      .send({
        email: 'student1@chess.test',
        newPassword: 'BrandNew1',
        confirmPassword: 'BrandNew1',
      });
    expect(setup.status).toBe(200);
    expect(setup.body.user.mustChangePassword).toBe(false);

    // ── Step 5: progress now accessible. ──
    const ok = await request(stack.app).get('/api/v1/progress').set('Cookie', student.cookies);
    expect(ok.status).toBe(200);
    expect(ok.body.completed).toEqual([]);

    // ── Step 6: temp password no longer works; new password works. ──
    const stale = await request(stack.app)
      .post('/api/v1/auth/login')
      .set('Cookie', (await withCsrf()).cookieHeader)
      .set('X-CSRF-Token', (await withCsrf()).token)
      .send({ username: 'student1', password: tempPwd });
    // (We need the matching CSRF token for stale login — use a fresh handshake.)
    const freshCsrf = await withCsrf();
    const stale2 = await request(stack.app)
      .post('/api/v1/auth/login')
      .set('Cookie', freshCsrf.cookieHeader)
      .set('X-CSRF-Token', freshCsrf.token)
      .send({ username: 'student1', password: tempPwd });
    expect(stale2.status).toBe(401);
    void stale;

    const fresh = await loginAs('student1', 'BrandNew1');
    expect(fresh.mustChangePassword).toBe(false);
  });

  it('progress route returns 403 setup_required for a must_change_password user', async () => {
    const admin = await loginAs('admin', 'admin123');
    expect(admin.user.isAdmin).toBe(true);
    const tempPwd = await createStudent(admin.cookies, admin.token, 's2');
    const student = await loginAs('s2', tempPwd);
    const r = await request(stack.app).get('/api/v1/progress').set('Cookie', student.cookies);
    expect(r.status).toBe(403);
  });

  it('env-admin login → no chess_sid cookie, gets chess_admin_sid instead', async () => {
    const { token, cookieHeader } = await withCsrf();
    const res = await request(stack.app)
      .post('/api/v1/auth/login')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', token)
      .send({ username: 'admin', password: 'admin123' });
    expect(res.status).toBe(200);
    expect(res.body.user.isAdmin).toBe(true);
    expect(res.body.user.id).toBeLessThan(0); // sentinel id
    const set = res.headers['set-cookie'] as string[];
    expect(set.some((c) => c.startsWith('chess_admin_sid='))).toBe(true);
    // Must NOT set chess_sid (only chess_admin_sid path)
    expect(set.some((c) => /^chess_sid=[^;]+/.test(c) && !c.startsWith('chess_sid=;'))).toBe(false);
  });
});
