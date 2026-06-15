import type { UsersRepository } from '../../infrastructure/repositories/users.repository.js';
import type { ProgressRepository } from '../../infrastructure/repositories/progress.repository.js';
import type { PasswordService } from './password.service.js';
import { childLogger } from '../../shared/logger.js';
import { ConflictError } from '../../shared/errors.js';

const log = childLogger({ component: 'seed' });

/**
 * Every module id on the roadmap (`מסך הפתיחה/index.html` → `MODULES`). Seeding
 * a user's `completed` list with all of these makes every station show as done,
 * which the roadmap renders as unlocked and freely playable.
 *
 * Keep this in sync with the `MODULES` array in the roadmap.
 */
const ALL_MODULE_IDS: readonly string[] = [
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

interface SeedUser {
  username: string;
  password: string;
  /**
   * When true, the user's progress is seeded with every module completed so
   * they can immediately see and play any lesson on the roadmap.
   */
  unlockAllModules?: boolean;
}

/**
 * The default test users required by the spec. Passwords are hashed via the
 * configured PasswordService before reaching the database; they never exist on
 * disk in plaintext.
 *
 * `baruch_admin` is a convenience account whose progress starts fully unlocked
 * (all modules completed) so every lesson is playable from the first login.
 *
 * Note: the operator admin is NOT seeded here. It is sourced from
 * `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env` and authenticated entirely
 * outside the database — see `EnvAdminService`.
 */
const DEFAULT_USERS: readonly SeedUser[] = [
  { username: 'tomer', password: 'tomer' },
  { username: 'baruch', password: 'baruch' },
  { username: 'baruch_admin', password: 'baruch_admin', unlockAllModules: true },
];

export interface SeedServiceDeps {
  usersRepo: UsersRepository;
  progressRepo: ProgressRepository;
  passwordService: PasswordService;
}

export interface SeedResult {
  createdDemo: string[];
  skippedDemo: string[];
}

export class SeedService {
  constructor(private readonly deps: SeedServiceDeps) {}

  async seed(): Promise<SeedResult> {
    const createdDemo: string[] = [];
    const skippedDemo: string[] = [];
    for (const u of DEFAULT_USERS) {
      const existing = this.deps.usersRepo.findByUsername(u.username);
      if (existing) {
        skippedDemo.push(u.username);
        // Self-heal: keep the unlock-all account's progress fully unlocked even
        // if it was created before this behaviour existed.
        if (u.unlockAllModules) this.ensureAllModulesCompleted(existing.id);
        continue;
      }
      const passwordHash = await this.deps.passwordService.hash(u.password);
      try {
        const created = this.deps.usersRepo.create({
          username: u.username,
          passwordHash,
          isAdmin: false,
          mustChangePassword: false,
        });
        if (u.unlockAllModules) this.ensureAllModulesCompleted(created.id);
        createdDemo.push(u.username);
      } catch (err) {
        if (err instanceof ConflictError) {
          skippedDemo.push(u.username);
          continue;
        }
        throw err;
      }
    }

    log.info({ createdDemo, skippedDemo }, 'demo user seeding complete');
    return { createdDemo, skippedDemo };
  }

  /**
   * Ensure the given user's `completed` list contains every module id, marking
   * all lessons as done (and therefore unlocked) on the roadmap. Existing cards
   * and per-module data are preserved.
   */
  private ensureAllModulesCompleted(userId: number): void {
    const current = this.deps.progressRepo.getByUserId(userId);
    const completed = new Set(current.completed);
    const alreadyComplete = ALL_MODULE_IDS.every((id) => completed.has(id));
    if (alreadyComplete) return;
    for (const id of ALL_MODULE_IDS) completed.add(id);
    this.deps.progressRepo.upsert(userId, { ...current, completed: [...completed] });
  }

  /** Back-compat alias for callers that used the previous method name. */
  async seedDefaultUsers(): Promise<SeedResult> {
    return this.seed();
  }
}
