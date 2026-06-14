import type { Db } from '../db/connection.js';
import { emptyProgress, normalizeProgress, type ProgressSnapshot } from '../../domain/progress.js';

interface ProgressRow {
  user_id: number;
  data_json: string;
  updated_at: string;
}

export class ProgressRepository {
  constructor(private readonly db: Db) {}

  getByUserId(userId: number): ProgressSnapshot {
    const row = this.db
      .prepare<[number], ProgressRow>(
        'SELECT user_id, data_json, updated_at FROM user_progress WHERE user_id = ?',
      )
      .get(userId);
    if (!row) return emptyProgress();
    try {
      const parsed: unknown = JSON.parse(row.data_json);
      return normalizeProgress(parsed);
    } catch {
      return emptyProgress();
    }
  }

  upsert(userId: number, snapshot: ProgressSnapshot): void {
    const normalized = normalizeProgress(snapshot);
    const payload = JSON.stringify(normalized);
    this.db
      .prepare(
        `INSERT INTO user_progress (user_id, data_json, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET
           data_json = excluded.data_json,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(userId, payload);
  }

  reset(userId: number): void {
    this.upsert(userId, emptyProgress());
  }
}
