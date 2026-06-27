import { randomInt } from 'node:crypto';
import { publicUser, USERNAME_MAX, type User } from '../../domain/user.js';
import { ConflictError, ValidationError } from '../../shared/errors.js';
import type { UsersRepository } from '../../infrastructure/repositories/users.repository.js';
import type { SessionsRepository } from '../../infrastructure/repositories/sessions.repository.js';
import type { PasswordService } from './password.service.js';
import { generateTempPassword } from './temp-password.js';
import { nowIso } from '../../shared/time.js';

export interface AdminServiceDeps {
  usersRepo: UsersRepository;
  sessionsRepo: SessionsRepository;
  passwordService: PasswordService;
}

export interface CreateStudentResult {
  user: User;
  temporaryPassword: string;
}

export interface BulkStudentInput {
  firstName: string;
  lastName: string;
}
export interface BulkCreatedRow {
  firstName: string;
  lastName: string;
  username: string;
  temporaryPassword: string;
}
export interface BulkErrorRow {
  row: number;
  firstName: string;
  lastName: string;
  reason: string;
}
export interface BulkCreateResult {
  created: BulkCreatedRow[];
  errors: BulkErrorRow[];
}

const USERNAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;

/** Per-name-part cap so first_last_NNNN always fits USERNAME_MAX (64). */
const NAME_PART_MAX = 28;

/**
 * Reduce a raw name to the characters allowed inside a username slug: any
 * Unicode letter or digit (so Hebrew names survive), everything else dropped.
 */
function slugifyNamePart(raw: string): string {
  return raw.normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '').slice(0, NAME_PART_MAX);
}

export class AdminService {
  constructor(private readonly deps: AdminServiceDeps) {}

  listUsers(): User[] {
    return this.deps.usersRepo.listAll();
  }

  /**
   * Create a new student account with a fresh, securely-generated temporary
   * password. The plaintext password is RETURNED ONCE so the admin can hand
   * it to the student. It is never stored, never logged.
   */
  async createStudent(username: string): Promise<CreateStudentResult> {
    const u = username.trim();
    if (!USERNAME_RE.test(u)) {
      throw new ValidationError(
        { field: 'username' },
        'Username may contain only letters, digits, underscore, dot, or hyphen (max 64).',
      );
    }
    if (this.deps.usersRepo.findByUsername(u)) {
      throw new ConflictError(`Username already exists: ${u}`);
    }
    const temporaryPassword = generateTempPassword();
    const passwordHash = await this.deps.passwordService.hash(temporaryPassword);
    const created = this.deps.usersRepo.create({
      username: u,
      passwordHash,
      isAdmin: false,
      mustChangePassword: true,
      temporaryPasswordCreatedAt: nowIso(),
    });
    return { user: publicUser(created), temporaryPassword };
  }

  /**
   * Bulk-create students from (firstName, lastName) pairs — e.g. a CSV import.
   * Each gets a generated username of the form `first_last_<4 digits>` and a
   * fresh one-time temporary password (returned so the caller can hand them
   * out). Rows that can't be created (empty name, unresolvable collision) are
   * collected in `errors` rather than aborting the whole batch.
   */
  async createStudentsBulk(students: BulkStudentInput[]): Promise<BulkCreateResult> {
    const created: BulkCreatedRow[] = [];
    const errors: BulkErrorRow[] = [];
    const takenInBatch = new Set<string>(); // lowercased usernames minted this run

    for (let i = 0; i < students.length; i++) {
      const row = i + 1;
      const firstName = (students[i]!.firstName ?? '').trim();
      const lastName = (students[i]!.lastName ?? '').trim();
      const first = slugifyNamePart(firstName);
      const last = slugifyNamePart(lastName);
      if (!first && !last) {
        errors.push({ row, firstName, lastName, reason: 'Row has no usable name.' });
        continue;
      }

      const username = this.mintUniqueUsername(first, last, takenInBatch);
      if (!username) {
        errors.push({ row, firstName, lastName, reason: 'Could not generate a unique username.' });
        continue;
      }

      const temporaryPassword = generateTempPassword();
      const passwordHash = await this.deps.passwordService.hash(temporaryPassword);
      try {
        this.deps.usersRepo.create({
          username,
          passwordHash,
          isAdmin: false,
          mustChangePassword: true,
          temporaryPasswordCreatedAt: nowIso(),
        });
        takenInBatch.add(username.toLowerCase());
        created.push({ firstName, lastName, username, temporaryPassword });
      } catch {
        errors.push({ row, firstName, lastName, reason: 'Username already exists.' });
      }
    }
    return { created, errors };
  }

  /**
   * Try a handful of `first_last_NNNN` candidates until one is free both in the
   * DB and within this batch. Returns null if every attempt collided.
   */
  private mintUniqueUsername(first: string, last: string, takenInBatch: Set<string>): string | null {
    for (let attempt = 0; attempt < 25; attempt++) {
      const digits = String(randomInt(0, 10000)).padStart(4, '0');
      const username = `${first}_${last}_${digits}`;
      if (username.length > USERNAME_MAX) return null;
      if (takenInBatch.has(username.toLowerCase())) continue;
      if (this.deps.usersRepo.findByUsername(username)) continue;
      return username;
    }
    return null;
  }

  /**
   * Rotate a student's temporary password (useful if the original was leaked
   * or never received). Forces them through the first-time setup again.
   */
  async regenerateTempPassword(userId: number): Promise<CreateStudentResult> {
    const user = this.deps.usersRepo.findById(userId);
    if (!user) throw new ValidationError({ field: 'userId' }, 'User not found.');
    if (user.isAdmin) {
      throw new ValidationError({ field: 'userId' }, 'Cannot regenerate an admin password from this endpoint.');
    }
    const temporaryPassword = generateTempPassword();
    const passwordHash = await this.deps.passwordService.hash(temporaryPassword);
    this.deps.usersRepo.updateSecret(userId, {
      passwordHash,
      passwordUpdatedAt: null,
      mustChangePassword: true,
      temporaryPasswordCreatedAt: nowIso(),
    });
    // Invalidate any active login sessions the student might have.
    this.deps.sessionsRepo.deleteByUserId(userId);
    const refreshed = this.deps.usersRepo.findById(userId);
    if (!refreshed) throw new Error('User vanished after regenerate.');
    return { user: refreshed, temporaryPassword };
  }

  /** Permanently delete a student account (and its cascaded sessions/progress). */
  deleteStudent(userId: number): void {
    const user = this.deps.usersRepo.findById(userId);
    if (!user) throw new ValidationError({ field: 'userId' }, 'User not found.');
    if (user.isAdmin) {
      throw new ValidationError({ field: 'userId' }, 'Cannot delete an admin account.');
    }
    this.deps.usersRepo.deleteById(userId);
  }

  /** Update a student's email address. */
  updateStudentEmail(userId: number, email: string): User {
    const user = this.deps.usersRepo.findById(userId);
    if (!user) throw new ValidationError({ field: 'userId' }, 'User not found.');
    this.deps.usersRepo.updateEmail(userId, email.trim());
    const refreshed = this.deps.usersRepo.findById(userId);
    if (!refreshed) throw new Error('User vanished after email update.');
    return refreshed;
  }
}
