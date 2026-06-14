import { loadEnv } from '../config/env.js';
import { openDb } from '../infrastructure/db/connection.js';
import { runMigrations } from '../infrastructure/db/migrator.js';
import { getLogger } from '../shared/logger.js';

const env = loadEnv();
const log = getLogger();
const db = openDb(env.DB_PATH);
try {
  const result = runMigrations(db);
  log.info({ result }, 'migrations complete');
} finally {
  db.close();
}
