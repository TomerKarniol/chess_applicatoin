import { describe, expect, it } from 'vitest';
import { EnvAdminService } from '../../src/application/services/env-admin.service.js';

function build(opts: { password?: string | undefined; ttlHours?: number } = {}): EnvAdminService {
  return new EnvAdminService({
    username: 'admin',
    password: opts.password,
    email: 'admin@chess.test',
    sessionTtlHours: opts.ttlHours ?? 12,
  });
}

describe('EnvAdminService', () => {
  it('is disabled when ADMIN_PASSWORD is empty / undefined', () => {
    const svc = build({ password: undefined });
    expect(svc.isEnabled()).toBe(false);
    expect(svc.verifyCredentials('admin', 'whatever')).toBe(false);
  });

  it('verifies the exact username + password match', () => {
    const svc = build({ password: 'admin123' });
    expect(svc.isEnabled()).toBe(true);
    expect(svc.verifyCredentials('admin', 'admin123')).toBe(true);
    expect(svc.verifyCredentials('ADMIN', 'admin123')).toBe(true); // case-insensitive username
    expect(svc.verifyCredentials('admin', 'WRONG')).toBe(false);
    expect(svc.verifyCredentials('other', 'admin123')).toBe(false);
    expect(svc.verifyCredentials('', '')).toBe(false);
  });

  it('mints sessions and resolves them by id', () => {
    const svc = build({ password: 'p' });
    const s = svc.createSession();
    expect(s.id).toMatch(/^[a-f0-9]{64}$/);
    expect(svc.resolveSession(s.id)?.username).toBe('admin');
    expect(svc.resolveSession('nope')).toBeNull();
    expect(svc.resolveSession(null)).toBeNull();
  });

  it('destroySession invalidates a session', () => {
    const svc = build({ password: 'p' });
    const s = svc.createSession();
    svc.destroySession(s.id);
    expect(svc.resolveSession(s.id)).toBeNull();
  });

  it('pruneExpired drops sessions whose expiry has passed', () => {
    // Configure 1-hour ttl so we can pretend time moved forward.
    const svc = build({ password: 'p', ttlHours: 1 });
    const s = svc.createSession();
    expect(svc.pruneExpired()).toBe(0); // not yet
    const removed = svc.pruneExpired(Date.now() + 2 * 60 * 60 * 1000);
    expect(removed).toBe(1);
    expect(svc.resolveSession(s.id)).toBeNull();
  });

  it('publicUser returns a synthetic user with the sentinel id and isAdmin', () => {
    const svc = build({ password: 'p' });
    const u = svc.publicUser();
    expect(u.id).toBeLessThan(0);
    expect(u.isAdmin).toBe(true);
    expect(u.mustChangePassword).toBe(false);
    expect(EnvAdminService.isEnvAdminUserId(u.id)).toBe(true);
  });
});
