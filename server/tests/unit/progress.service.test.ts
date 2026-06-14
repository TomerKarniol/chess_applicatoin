import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/infrastructure/db/connection.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { UsersRepository } from '../../src/infrastructure/repositories/users.repository.js';
import { ProgressRepository } from '../../src/infrastructure/repositories/progress.repository.js';
import { ProgressService } from '../../src/application/services/progress.service.js';
import type { ProgressSnapshot } from '../../src/domain/progress.js';

describe('ProgressService', () => {
  let db: ReturnType<typeof openDb>;
  let svc: ProgressService;
  let users: UsersRepository;

  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
    users = new UsersRepository(db);
    svc = new ProgressService(new ProgressRepository(db));
  });

  afterEach(() => {
    db.close();
  });

  function snap(partial: Partial<ProgressSnapshot> = {}): ProgressSnapshot {
    return {
      completed: partial.completed ?? [],
      cards: partial.cards ?? [],
      modules: partial.modules ?? {},
      currentModule: partial.currentModule ?? null,
    };
  }

  it('returns an empty snapshot for a user who has never saved', () => {
    const u = users.create({ username: 'a', passwordHash: 'h' });
    expect(svc.getForUser(u.id)).toEqual(snap());
  });

  it('saveForUser is idempotent and the latest write wins', () => {
    const u = users.create({ username: 'a', passwordHash: 'h' });
    svc.saveForUser(u.id, snap({ completed: ['rook'] }));
    svc.saveForUser(u.id, snap({ completed: ['rook', 'bishop'], currentModule: 'queen' }));
    expect(svc.getForUser(u.id)).toEqual(
      snap({ completed: ['rook', 'bishop'], currentModule: 'queen' }),
    );
  });

  it('progress is isolated per user', () => {
    const tomer = users.create({ username: 'tomer', passwordHash: 'h' });
    const baruch = users.create({ username: 'baruch', passwordHash: 'h' });

    svc.saveForUser(tomer.id, snap({ completed: ['rook', 'bishop'] }));
    svc.saveForUser(baruch.id, snap({ completed: ['queen'] }));

    expect(svc.getForUser(tomer.id).completed).toEqual(['rook', 'bishop']);
    expect(svc.getForUser(baruch.id).completed).toEqual(['queen']);
  });

  it('resetForUser only clears the given user', () => {
    const tomer = users.create({ username: 'tomer', passwordHash: 'h' });
    const baruch = users.create({ username: 'baruch', passwordHash: 'h' });
    svc.saveForUser(tomer.id, snap({ completed: ['rook'] }));
    svc.saveForUser(baruch.id, snap({ completed: ['queen'] }));

    svc.resetForUser(tomer.id);

    expect(svc.getForUser(tomer.id).completed).toEqual([]);
    expect(svc.getForUser(baruch.id).completed).toEqual(['queen']);
  });

  it('drops unknown fields when persisting (normalization)', () => {
    const u = users.create({ username: 'a', passwordHash: 'h' });
    svc.saveForUser(u.id, {
      completed: ['rook'],
      cards: ['rook'],
      modules: { rook: { stage1: { done: true } } },
      currentModule: 'bishop',
      // @ts-expect-error: extra field is normalized out
      pwned: { bypass: true },
    });
    const back = svc.getForUser(u.id);
    expect(Object.keys(back).sort()).toEqual(['cards', 'completed', 'currentModule', 'modules']);
  });
});
