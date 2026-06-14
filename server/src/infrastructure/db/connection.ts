import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database, { type Database as DbInstance } from 'better-sqlite3';

export type Db = DbInstance;

/**
 * Open a SQLite connection with the production-recommended pragmas:
 *   - WAL journal for concurrent reads.
 *   - foreign_keys=ON to enforce ON DELETE CASCADE.
 *   - busy_timeout to gracefully handle short write contention.
 *
 * The ':memory:' path is honored verbatim so tests can use a private db.
 */
export function openDb(path: string): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}
