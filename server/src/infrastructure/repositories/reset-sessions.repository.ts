import type { Db } from '../db/connection.js';
import type { ResetSession } from '../../domain/reset-code.js';
import { isPastIso } from '../../shared/time.js';

interface ResetSessionRow {
  id: string;
  user_id: number;
  code_id: number;
  created_at: string;
  expires_at: string;
}

function rowToSession(row: ResetSessionRow): ResetSession {
  return {
    id: row.id,
    userId: row.user_id,
    codeId: row.code_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export interface CreateResetSessionInput {
  id: string;
  userId: number;
  codeId: number;
  expiresAt: string;
}

export class ResetSessionsRepository {
  constructor(private readonly db: Db) {}

  create(input: CreateResetSessionInput): ResetSession {
    this.db
      .prepare('INSERT INTO reset_sessions (id, user_id, code_id, expires_at) VALUES (?, ?, ?, ?)')
      .run(input.id, input.userId, input.codeId, input.expiresAt);
    const row = this.findById(input.id);
    if (!row) throw new Error('Reset session insert succeeded but row was not found.');
    return row;
  }

  private findById(id: string): ResetSession | null {
    const row = this.db
      .prepare<[string], ResetSessionRow>(
        'SELECT id, user_id, code_id, created_at, expires_at FROM reset_sessions WHERE id = ?',
      )
      .get(id);
    return row ? rowToSession(row) : null;
  }

  findValidById(id: string, now: Date = new Date()): ResetSession | null {
    const row = this.findById(id);
    if (!row) return null;
    if (isPastIso(row.expiresAt, now)) {
      this.deleteById(id);
      return null;
    }
    return row;
  }

  deleteById(id: string): void {
    this.db.prepare('DELETE FROM reset_sessions WHERE id = ?').run(id);
  }

  deleteByUserId(userId: number): number {
    const info = this.db.prepare('DELETE FROM reset_sessions WHERE user_id = ?').run(userId);
    return Number(info.changes);
  }

  deleteExpired(now: Date = new Date()): number {
    const info = this.db
      .prepare('DELETE FROM reset_sessions WHERE expires_at <= ?')
      .run(now.toISOString());
    return Number(info.changes);
  }
}
