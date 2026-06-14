import type { ProgressSnapshot } from '../../domain/progress.js';
import type { ProgressRepository } from '../../infrastructure/repositories/progress.repository.js';

export class ProgressService {
  constructor(private readonly progressRepo: ProgressRepository) {}

  getForUser(userId: number): ProgressSnapshot {
    return this.progressRepo.getByUserId(userId);
  }

  saveForUser(userId: number, snapshot: ProgressSnapshot): void {
    this.progressRepo.upsert(userId, snapshot);
  }

  resetForUser(userId: number): void {
    this.progressRepo.reset(userId);
  }
}
