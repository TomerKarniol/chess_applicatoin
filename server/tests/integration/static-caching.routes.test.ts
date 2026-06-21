import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestStack, type TestStack } from '../helpers/test-app.js';

/**
 * The frontend ships no cache-busting (no hashed filenames). If HTML documents
 * are allowed to be cached, a device keeps serving a stale page for up to the
 * static `maxAge` — which is how a device ran an old roadmap without the
 * per-user progress sync scripts and showed modules locked inconsistently
 * across devices. HTML must therefore always be revalidated.
 */
describe('static caching', () => {
  let stack: TestStack;

  beforeEach(async () => {
    // Serve the real repo root so the actual frontend files are reachable.
    stack = await buildTestStack({ envOverrides: { STATIC_ROOT: '..' } });
  });

  afterEach(() => {
    stack.closeDb();
  });

  it('serves HTML documents with a no-cache revalidation policy', async () => {
    const res = await request(stack.app).get('/auth/login.html');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
    // ETag is still present so revalidation stays cheap (304 when unchanged).
    expect(res.headers['etag']).toBeTruthy();
  });

  it('does not force no-cache on non-HTML assets', async () => {
    const res = await request(stack.app).get('/auth/js/bridge.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control'] ?? '').not.toContain('no-cache');
  });
});
