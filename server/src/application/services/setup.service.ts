import { publicUser, type User, validateNewPassword } from '../../domain/user.js';
import { AppError, NotFoundError, ValidationError } from '../../shared/errors.js';
import type { UsersRepository } from '../../infrastructure/repositories/users.repository.js';
import type { PasswordService } from './password.service.js';

export interface SetupServiceDeps {
  usersRepo: UsersRepository;
  passwordService: PasswordService;
}

export interface CompleteSetupInput {
  email: string;
  newPassword: string;
  confirmPassword: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class SetupService {
  constructor(private readonly deps: SetupServiceDeps) {}

  /**
   * Completes the first-time setup for a user: validates the email and password,
   * persists the new credentials, and clears the must_change_password flag.
   * Caller must have an authenticated session for `userId`.
   */
  async completeFirstTimeSetup(userId: number, input: CompleteSetupInput): Promise<User> {
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) {
      throw new ValidationError({ field: 'email' }, 'Invalid email address.');
    }
    if (input.newPassword !== input.confirmPassword) {
      throw new ValidationError({ field: 'confirmPassword' }, 'Passwords do not match.');
    }
    const violation = validateNewPassword(input.newPassword);
    if (violation) {
      throw new ValidationError({ field: 'newPassword', code: violation.code }, violation.message);
    }

    const current = this.deps.usersRepo.findSecretById(userId);
    if (!current) throw new NotFoundError('User not found.');

    // Emails are intentionally NOT unique — several accounts may share one
    // address (siblings, a class under a teacher's email), so no dedupe here.

    const passwordHash = await this.deps.passwordService.hash(input.newPassword);
    const now = new Date().toISOString();

    this.deps.usersRepo.updateEmail(userId, email);
    this.deps.usersRepo.updateSecret(userId, {
      passwordHash,
      passwordUpdatedAt: now,
      mustChangePassword: false,
      temporaryPasswordCreatedAt: null,
    });

    const fresh = this.deps.usersRepo.findById(userId);
    if (!fresh) throw new AppError({
      statusCode: 500,
      code: 'internal_error',
      message: 'User vanished after update.',
    });
    return publicUser(fresh);
  }
}
