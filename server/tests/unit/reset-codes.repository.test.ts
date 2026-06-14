import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/infrastructure/db/connection.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { UsersRepository } from '../../src/infrastructure/repositories/users.repository.js';
import { ResetCodesRepository } from '../../src/infrastructure/repositories/reset-codes.repository.js';
import { addDays } from '../../src/shared/time.js';

describe('ResetCodesRepository', () => {
  let db: ReturnType<typeof openDb>;
  let usersRepo: UsersRepository;
  let repo: ResetCodesRepository;

  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
    usersRepo = new UsersRepository(db);
    repo = new ResetCodesRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function makeUser() {
    return usersRepo.create({ username: 'alice', passwordHash: 'fake' });
  }

  it('creating a new code invalidates any earlier pending code for the user', () => {
    const user = makeUser();
    const first = repo.create({
      userId: user.id,
      codeHash: 'h1',
      expiresAt: addDays(new Date(), 1).toISOString(),
    });
    const second = repo.create({
      userId: user.id,
      codeHash: 'h2',
      expiresAt: addDays(new Date(), 1).toISOString(),
    });

    const firstReloaded = repo.findById(first.id);
    expect(firstReloaded?.usedAt).not.toBeNull();

    const latest = repo.findLatestActiveForUser(user.id);
    expect(latest?.id).toBe(second.id);
    expect(latest?.usedAt).toBeNull();
  });

  it('incrementAttempts returns the new attempts counter', () => {
    const user = makeUser();
    const rec = repo.create({
      userId: user.id,
      codeHash: 'h',
      expiresAt: addDays(new Date(), 1).toISOString(),
    });
    expect(repo.incrementAttempts(rec.id)).toBe(1);
    expect(repo.incrementAttempts(rec.id)).toBe(2);
    expect(repo.incrementAttempts(rec.id)).toBe(3);
  });

  it('markVerified and markUsed set the timestamps', () => {
    const user = makeUser();
    const rec = repo.create({
      userId: user.id,
      codeHash: 'h',
      expiresAt: addDays(new Date(), 1).toISOString(),
    });
    repo.markVerified(rec.id);
    const verified = repo.findById(rec.id);
    expect(verified?.verifiedAt).not.toBeNull();
    expect(verified?.usedAt).toBeNull();

    repo.markUsed(rec.id);
    const used = repo.findById(rec.id);
    expect(used?.usedAt).not.toBeNull();
  });

  it('deleteExpired sweeps codes whose expiry has passed', () => {
    const user = makeUser();
    repo.create({ userId: user.id, codeHash: 'h-past', expiresAt: '2000-01-01T00:00:00Z' });
    repo.create({
      userId: user.id,
      codeHash: 'h-future',
      expiresAt: addDays(new Date(), 1).toISOString(),
    });
    const removed = repo.deleteExpired();
    expect(removed).toBeGreaterThanOrEqual(1);
  });
});
