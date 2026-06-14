import type { Db } from '../db/connection.js';
import type { ResetCodeRecord } from '../../domain/reset-code.js';

interface ResetCodeRow {
  id: number;
  user_id: number;
  code_hash: string;
  expires_at: string;
  verified_at: string | null;
  used_at: string | null;
  attempts: number;
  created_at: string;
}

function rowToRecord(row: ResetCodeRow): ResetCodeRecord {
  return {
    id: row.id,
    userId: row.user_id,
    codeHash: row.code_hash,
    expiresAt: row.expires_at,
    verifiedAt: row.verified_at,
    usedAt: row.used_at,
    attempts: row.attempts,
    createdAt: row.created_at,
  };
}

export interface CreateResetCodeInput {
  userId: number;
  codeHash: string;
  expiresAt: string;
}

export class ResetCodesRepository {
  constructor(private readonly db: Db) {}

  /**
   * Issue a fresh reset code. Any earlier still-pending codes for the same
   * user are invalidated so only the most recent code can ever succeed.
   */
  create(input: CreateResetCodeInput): ResetCodeRecord {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE password_reset_codes
              SET used_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND used_at IS NULL`,
        )
        .run(input.userId);
      const info = this.db
        .prepare(
          'INSERT INTO password_reset_codes (user_id, code_hash, expires_at) VALUES (?, ?, ?)',
        )
        .run(input.userId, input.codeHash, input.expiresAt);
      return Number(info.lastInsertRowid);
    });
    const id = tx();
    const row = this.findById(id);
    if (!row) throw new Error('Reset code insert succeeded but row was not found.');
    return row;
  }

  findById(id: number): ResetCodeRecord | null {
    const row = this.db
      .prepare<[number], ResetCodeRow>(
        'SELECT id, user_id, code_hash, expires_at, verified_at, used_at, attempts, created_at FROM password_reset_codes WHERE id = ?',
      )
      .get(id);
    return row ? rowToRecord(row) : null;
  }

  findLatestActiveForUser(userId: number): ResetCodeRecord | null {
    const row = this.db
      .prepare<[number], ResetCodeRow>(
        `SELECT id, user_id, code_hash, expires_at, verified_at, used_at, attempts, created_at
           FROM password_reset_codes
          WHERE user_id = ?
            AND used_at IS NULL
          ORDER BY id DESC
          LIMIT 1`,
      )
      .get(userId);
    return row ? rowToRecord(row) : null;
  }

  incrementAttempts(id: number): number {
    this.db
      .prepare('UPDATE password_reset_codes SET attempts = attempts + 1 WHERE id = ?')
      .run(id);
    const row = this.db
      .prepare<[number], { attempts: number }>(
        'SELECT attempts FROM password_reset_codes WHERE id = ?',
      )
      .get(id);
    return row?.attempts ?? 0;
  }

  markVerified(id: number): void {
    this.db
      .prepare(
        'UPDATE password_reset_codes SET verified_at = CURRENT_TIMESTAMP WHERE id = ?',
      )
      .run(id);
  }

  markUsed(id: number): void {
    this.db
      .prepare('UPDATE password_reset_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(id);
  }

  deleteExpired(now: Date = new Date()): number {
    const info = this.db
      .prepare('DELETE FROM password_reset_codes WHERE expires_at <= ?')
      .run(now.toISOString());
    return Number(info.changes);
  }
}
