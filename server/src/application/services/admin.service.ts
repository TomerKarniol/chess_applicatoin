import { publicUser, type User } from '../../domain/user.js';
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

const USERNAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;

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
}
