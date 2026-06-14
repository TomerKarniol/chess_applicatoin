import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './connection.js';
import { runSql } from './sql.js';
import { childLogger } from '../../shared/logger.js';

const log = childLogger({ component: 'migrator' });

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

interface MigrationFile {
  version: string;
  filename: string;
  sql: string;
}

function loadMigrations(): MigrationFile[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 001_, 002_, … sort lexicographically.
  return files.map((filename) => {
    const version = filename.replace(/\.sql$/, '');
    const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8');
    return { version, filename, sql };
  });
}

function ensureMigrationsTable(db: Db): void {
  runSql(
    db,
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     );`,
  );
}

function appliedVersions(db: Db): Set<string> {
  const rows = db
    .prepare<[], { version: string }>('SELECT version FROM schema_migrations')
    .all();
  return new Set(rows.map((r) => r.version));
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Apply every pending migration. Each .sql file is treated as one logical
 * migration; we wrap it in a transaction so a mid-file failure rolls back
 * cleanly and the version row is never recorded.
 */
export function runMigrations(db: Db): MigrationResult {
  ensureMigrationsTable(db);
  const applied: string[] = [];
  const skipped: string[] = [];
  const done = appliedVersions(db);

  for (const m of loadMigrations()) {
    if (done.has(m.version)) {
      skipped.push(m.version);
      continue;
    }
    const tx = db.transaction(() => {
      runSql(db, m.sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(m.version);
    });
    tx();
    applied.push(m.version);
    log.info({ version: m.version }, 'migration applied');
  }

  return { applied, skipped };
}
