import type { Db } from '../db/connection.js';
import type { Session } from '../../domain/session.js';
import { isPastIso } from '../../shared/time.js';

interface SessionRow {
  id: string;
  user_id: number;
  created_at: string;
  expires_at: string;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export interface CreateSessionInput {
  id: string;
  userId: number;
  expiresAt: string;
}

export class SessionsRepository {
  constructor(private readonly db: Db) {}

  create(input: CreateSessionInput): Session {
    this.db
      .prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
      .run(input.id, input.userId, input.expiresAt);
    const row = this.db
      .prepare<[string], SessionRow>(
        'SELECT id, user_id, created_at, expires_at FROM sessions WHERE id = ?',
      )
      .get(input.id);
    if (!row) throw new Error('Session insert succeeded but row was not found.');
    return rowToSession(row);
  }

  findValidById(id: string, now: Date = new Date()): Session | null {
    const row = this.db
      .prepare<[string], SessionRow>(
        'SELECT id, user_id, created_at, expires_at FROM sessions WHERE id = ?',
      )
      .get(id);
    if (!row) return null;
    if (isPastIso(row.expires_at, now)) {
      this.deleteById(id);
      return null;
    }
    return rowToSession(row);
  }

  deleteById(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  deleteByUserId(userId: number): number {
    const info = this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    return Number(info.changes);
  }

  deleteExpired(now: Date = new Date()): number {
    const info = this.db
      .prepare('DELETE FROM sessions WHERE expires_at <= ?')
      .run(now.toISOString());
    return Number(info.changes);
  }
}
