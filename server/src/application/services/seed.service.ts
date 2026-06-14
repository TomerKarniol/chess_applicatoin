import type { UsersRepository } from '../../infrastructure/repositories/users.repository.js';
import type { PasswordService } from './password.service.js';
import { childLogger } from '../../shared/logger.js';
import { ConflictError } from '../../shared/errors.js';

const log = childLogger({ component: 'seed' });

interface SeedUser {
  username: string;
  password: string;
}

/**
 * The two default test users required by the spec. Passwords are hashed via
 * the configured PasswordService before reaching the database; they never
 * exist on disk in plaintext.
 *
 * Note: the admin user is NOT seeded here. Admin is sourced from
 * `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env` and authenticated entirely
 * outside the database — see `EnvAdminService`.
 */
const DEFAULT_USERS: readonly SeedUser[] = [
  { username: 'tomer', password: 'tomer' },
  { username: 'baruch', password: 'baruch' },
];

export interface SeedServiceDeps {
  usersRepo: UsersRepository;
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
        continue;
      }
      const passwordHash = await this.deps.passwordService.hash(u.password);
      try {
        this.deps.usersRepo.create({
          username: u.username,
          passwordHash,
          isAdmin: false,
          mustChangePassword: false,
        });
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

  /** Back-compat alias for callers that used the previous method name. */
  async seedDefaultUsers(): Promise<SeedResult> {
    return this.seed();
  }
}
