import { fullyCompletedProgress, type ProgressSnapshot } from '../../domain/progress.js';
import type { ProgressRepository } from '../../infrastructure/repositories/progress.repository.js';

export class ProgressService {
  constructor(private readonly progressRepo: ProgressRepository) {}

  /**
   * When `unlockAll` is set, the caller (showcase/admin accounts) always sees
   * every module unlocked, regardless of what — if anything — is stored for them,
   * so the same account behaves identically on every device/browser. Normal
   * players get their persisted snapshot.
   */
  getForUser(userId: number, unlockAll = false): ProgressSnapshot {
    if (unlockAll) return fullyCompletedProgress();
    return this.progressRepo.getByUserId(userId);
  }

  saveForUser(userId: number, snapshot: ProgressSnapshot): void {
    this.progressRepo.upsert(userId, snapshot);
  }

  resetForUser(userId: number): void {
    this.progressRepo.reset(userId);
  }
}
