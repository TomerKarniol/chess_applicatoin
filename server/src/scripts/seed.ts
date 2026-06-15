import { loadEnv } from '../config/env.js';
import { openDb } from '../infrastructure/db/connection.js';
import { runMigrations } from '../infrastructure/db/migrator.js';
import { UsersRepository } from '../infrastructure/repositories/users.repository.js';
import { ProgressRepository } from '../infrastructure/repositories/progress.repository.js';
import { Argon2PasswordService } from '../application/services/password.service.js';
import { SeedService } from '../application/services/seed.service.js';
import { getLogger } from '../shared/logger.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const log = getLogger();
  const db = openDb(env.DB_PATH);
  try {
    runMigrations(db);
    const usersRepo = new UsersRepository(db);
    const progressRepo = new ProgressRepository(db);
    const passwordService = new Argon2PasswordService();
    const seed = new SeedService({ usersRepo, progressRepo, passwordService });
    const result = await seed.seed();
    log.info({ result }, 'seed complete');
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error('seed failed:', err);
  process.exit(1);
});
