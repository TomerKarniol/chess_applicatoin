import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/infrastructure/db/connection.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { UsersRepository } from '../../src/infrastructure/repositories/users.repository.js';
import { ConflictError } from '../../src/shared/errors.js';

describe('UsersRepository', () => {
  let db: ReturnType<typeof openDb>;
  let repo: UsersRepository;

  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
    repo = new UsersRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates a user and reads it back by username and id', () => {
    const created = repo.create({ username: 'alice', passwordHash: 'fake-hash' });
    expect(created.username).toBe('alice');

    const byUsername = repo.findByUsername('alice');
    expect(byUsername?.id).toBe(created.id);
    expect(byUsername?.passwordHash).toBe('fake-hash');

    const byId = repo.findById(created.id);
    expect(byId?.username).toBe('alice');
  });

  it('username lookup is case-insensitive', () => {
    repo.create({ username: 'alice', passwordHash: 'h' });
    expect(repo.findByUsername('ALICE')).not.toBeNull();
    expect(repo.findByUsername('AlIcE')?.username).toBe('alice');
  });

  it('throws ConflictError on duplicate username', () => {
    repo.create({ username: 'bob', passwordHash: 'h1' });
    expect(() => repo.create({ username: 'bob', passwordHash: 'h2' })).toThrow(ConflictError);
    expect(() => repo.create({ username: 'BOB', passwordHash: 'h2' })).toThrow(ConflictError);
  });

  it('listAll returns users in insertion order', () => {
    repo.create({ username: 'a', passwordHash: 'h' });
    repo.create({ username: 'b', passwordHash: 'h' });
    repo.create({ username: 'c', passwordHash: 'h' });
    expect(repo.listAll().map((u) => u.username)).toEqual(['a', 'b', 'c']);
  });

  it('findById returns null for unknown ids', () => {
    expect(repo.findById(9999)).toBeNull();
    expect(repo.findByUsername('nope')).toBeNull();
  });
});
