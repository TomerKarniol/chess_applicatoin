import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestStack, type TestStack } from '../helpers/test-app.js';

const ROADMAP_DIR = 'מסך הפתיחה';
const roadmapUrl = `/${encodeURIComponent(ROADMAP_DIR)}/index.html`;

/**
 * The roadmap must always load the per-user progress sync scripts, otherwise
 * module locks are driven purely by the device's localStorage and differ per
 * browser/device (and `baruch_admin` shows up locked on fresh sessions). The
 * scripts are injected by the server so a frontend rewrite can't drop them.
 */
describe('roadmap sync injection', () => {
  let stack: TestStack;

  beforeEach(async () => {
    stack = await buildTestStack({ envOverrides: { STATIC_ROOT: '..' } });
  });

  afterEach(() => {
    stack.closeDb();
  });

  it('injects the three sync scripts before </head> on the roadmap', async () => {
    const res = await request(stack.app).get(roadmapUrl);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-cache');

    const html = res.text;
    expect(html).toContain('<script src="/auth/js/api.js"></script>');
    expect(html).toContain('<script src="/auth/js/bridge.js"></script>');
    expect(html).toContain('<script src="/auth/js/auth-guard.js"></script>');

    // All three must sit before the head closes so they run before the
    // roadmap's own DOMContentLoaded paint.
    const guardIdx = html.indexOf('/auth/js/auth-guard.js');
    const headCloseIdx = html.indexOf('</head>');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(headCloseIdx).toBeGreaterThan(guardIdx);

    // Each script injected exactly once (idempotent / no duplicates).
    expect(html.split('/auth/js/auth-guard.js').length - 1).toBe(1);
  });

  it('also injects when the roadmap is requested with a trailing slash', async () => {
    const res = await request(stack.app).get(`/${encodeURIComponent(ROADMAP_DIR)}/`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<script src="/auth/js/auth-guard.js"></script>');
  });

  it('does not inject the guard into other pages (e.g. the login page)', async () => {
    const res = await request(stack.app).get('/auth/login.html');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('/auth/js/auth-guard.js');
  });
});
