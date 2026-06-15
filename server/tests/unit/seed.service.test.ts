import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/infrastructure/db/connection.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { UsersRepository } from '../../src/infrastructure/repositories/users.repository.js';
import { ProgressRepository } from '../../src/infrastructure/repositories/progress.repository.js';
import { Argon2PasswordService } from '../../src/application/services/password.service.js';
import { SeedService } from '../../src/application/services/seed.service.js';

const ALL_MODULE_IDS = [
  'rook',
  'bishop',
  'queen',
  'pawn',
  'knight',
  'king',
  'officers-game',
  'check',
  'defense',
  'checkmate',
  'tofeset',
];

describe('SeedService', () => {
  let db: ReturnType<typeof openDb>;
  let usersRepo: UsersRepository;
  let progressRepo: ProgressRepository;
  let seed: SeedService;

  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
    usersRepo = new UsersRepository(db);
    progressRepo = new ProgressRepository(db);
    seed = new SeedService({ usersRepo, progressRepo, passwordService: new Argon2PasswordService() });
  });

  afterEach(() => {
    db.close();
  });

  it('creates the default demo users including baruch_admin', async () => {
    const result = await seed.seed();
    expect(result.createdDemo.sort()).toEqual(['baruch', 'baruch_admin', 'tomer']);
    expect(usersRepo.findByUsername('baruch_admin')).not.toBeNull();
  });

  it('seeds baruch_admin with every module unlocked (all completed)', async () => {
    await seed.seed();
    const admin = usersRepo.findByUsername('baruch_admin');
    expect(admin).not.toBeNull();
    const progress = progressRepo.getByUserId(admin!.id);
    expect([...progress.completed].sort()).toEqual([...ALL_MODULE_IDS].sort());
  });

  it('leaves regular demo users with empty progress', async () => {
    await seed.seed();
    const baruch = usersRepo.findByUsername('baruch');
    expect(progressRepo.getByUserId(baruch!.id).completed).toEqual([]);
  });

  it('is idempotent: re-seeding skips existing users and keeps admin unlocked', async () => {
    await seed.seed();
    const second = await seed.seed();
    expect(second.createdDemo).toEqual([]);
    expect(second.skippedDemo.sort()).toEqual(['baruch', 'baruch_admin', 'tomer']);

    const admin = usersRepo.findByUsername('baruch_admin');
    const progress = progressRepo.getByUserId(admin!.id);
    expect([...progress.completed].sort()).toEqual([...ALL_MODULE_IDS].sort());
  });

  it('self-heals: unlocks all modules for a pre-existing baruch_admin with empty progress', async () => {
    // Simulate an account created before the unlock-all behaviour existed.
    const stale = usersRepo.create({ username: 'baruch_admin', passwordHash: 'h' });
    expect(progressRepo.getByUserId(stale.id).completed).toEqual([]);

    await seed.seed();

    const progress = progressRepo.getByUserId(stale.id);
    expect([...progress.completed].sort()).toEqual([...ALL_MODULE_IDS].sort());
  });
});
