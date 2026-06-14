import type { Express } from 'express';
import request, { type Test } from 'supertest';

/**
 * Bootstraps a same-origin client by fetching a CSRF token via GET. Returns
 * the token and the Cookie header to attach to every follow-up request.
 *
 * Use it like:
 *   const { token, cookieHeader } = await primeCsrf(app);
 *   await request(app).post('/api/v1/auth/login').set('Cookie', cookieHeader).set('X-CSRF-Token', token)…
 */
export async function primeCsrf(app: Express): Promise<{ token: string; cookieHeader: string }> {
  const res = await request(app).get('/api/v1/csrf-token');
  const setCookie = res.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const csrfRaw = cookies.find((c) => c.startsWith('chess_csrf='));
  if (!csrfRaw) throw new Error('csrf cookie missing on /csrf-token response');
  const token = csrfRaw.split(';')[0]!.split('=')[1]!;
  const cookieHeader = `chess_csrf=${token}`;
  return { token, cookieHeader };
}

/**
 * Attach the CSRF header + cookie to a supertest request. Returns the
 * same Test for chaining.
 */
export function withCsrf(req: Test, token: string, extraCookies: string[] = []): Test {
  const allCookies = [`chess_csrf=${token}`, ...extraCookies].join('; ');
  return req.set('X-CSRF-Token', token).set('Cookie', allCookies);
}
