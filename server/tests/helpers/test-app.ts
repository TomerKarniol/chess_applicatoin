import { openDb } from '../../src/infrastructure/db/connection.js';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';
import { UsersRepository } from '../../src/infrastructure/repositories/users.repository.js';
import { ProgressRepository } from '../../src/infrastructure/repositories/progress.repository.js';
import { SessionsRepository } from '../../src/infrastructure/repositories/sessions.repository.js';
import { ResetCodesRepository } from '../../src/infrastructure/repositories/reset-codes.repository.js';
import { ResetSessionsRepository } from '../../src/infrastructure/repositories/reset-sessions.repository.js';
import { Argon2PasswordService } from '../../src/application/services/password.service.js';
import { AuthService } from '../../src/application/services/auth.service.js';
import { ProgressService } from '../../src/application/services/progress.service.js';
import { SeedService } from '../../src/application/services/seed.service.js';
import { SetupService } from '../../src/application/services/setup.service.js';
import { AdminService } from '../../src/application/services/admin.service.js';
import { EnvAdminService } from '../../src/application/services/env-admin.service.js';
import {
  PasswordResetService,
  type PasswordResetServiceDeps,
} from '../../src/application/services/password-reset.service.js';
import {
  ConsoleEmailService,
  type EmailMessage,
  type EmailService,
} from '../../src/application/services/email.service.js';
import { createApp } from '../../src/presentation/http/app.js';
import type { Env } from '../../src/config/env.js';
import type { Express } from 'express';

/**
 * In-memory email transport that records every send. Used by integration
 * tests to assert against the reset-code email body without hitting SMTP.
 */
export class CapturingEmailService implements EmailService {
  public readonly transportName = 'capturing';
  public readonly sent: EmailMessage[] = [];
  verify(): Promise<void> {
    return Promise.resolve();
  }
  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
  /** Extract the most recent 6-digit code from the last sent email (if any). */
  lastCode(): string | null {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const text = this.sent[i]!.text;
      const match = text.match(/\b(\d{6})\b/);
      if (match) return match[1] ?? null;
    }
    return null;
  }
}

export interface TestStack {
  app: Express;
  authService: AuthService;
  progressService: ProgressService;
  setupService: SetupService;
  adminService: AdminService;
  passwordResetService: PasswordResetService;
  usersRepo: UsersRepository;
  progressRepo: ProgressRepository;
  sessionsRepo: SessionsRepository;
  resetCodesRepo: ResetCodesRepository;
  resetSessionsRepo: ResetSessionsRepository;
  passwordService: Argon2PasswordService;
  seedService: SeedService;
  emailService: CapturingEmailService;
  db: ReturnType<typeof openDb>;
  closeDb: () => void;
}

export interface BuildTestStackOptions {
  seed?: boolean;
  emailService?: EmailService;
  envOverrides?: Partial<Env>;
}

export async function buildTestStack(opts: BuildTestStackOptions = {}): Promise<TestStack> {
  const db = openDb(':memory:');
  runMigrations(db);

  const usersRepo = new UsersRepository(db);
  const progressRepo = new ProgressRepository(db);
  const sessionsRepo = new SessionsRepository(db);
  const resetCodesRepo = new ResetCodesRepository(db);
  const resetSessionsRepo = new ResetSessionsRepository(db);
  const passwordService = new Argon2PasswordService();
  const emailService =
    (opts.emailService as CapturingEmailService) ?? new CapturingEmailService();

  const envAdminService = new EnvAdminService({
    username: 'admin',
    password: 'admin123',
    email: 'admin@chess.test',
    sessionTtlHours: 12,
  });

  const authService = new AuthService({
    usersRepo,
    sessionsRepo,
    passwordService,
    envAdminService,
    sessionTtlDays: 30,
  });
  const progressService = new ProgressService(progressRepo);
  const setupService = new SetupService({ usersRepo, passwordService });
  const adminService = new AdminService({ usersRepo, sessionsRepo, passwordService });

  const resetDeps: PasswordResetServiceDeps = {
    usersRepo,
    resetCodesRepo,
    resetSessionsRepo,
    sessionsRepo,
    passwordService,
    emailService,
    codeTtlMinutes: 15,
    resetSessionTtlMinutes: 5,
    maxAttempts: 5,
    appPublicName: 'אני מפלצת שחמט!',
  };
  const passwordResetService = new PasswordResetService(resetDeps);

  const seedService = new SeedService({ usersRepo, progressRepo, passwordService });

  if (opts.seed !== false) {
    await seedService.seed();
  }

  const env: Env = {
    NODE_ENV: 'test',
    PORT: 0,
    COOKIE_SECRET: 'test-cookie-secret-please-override-1234',
    DB_PATH: ':memory:',
    LOG_LEVEL: 'silent',
    SESSION_TTL_DAYS: 30,
    LOGIN_RATE_LIMIT_MAX: 1000,
    LOGIN_RATE_LIMIT_WINDOW_MS: 60_000,
    STATIC_ROOT: '.',
    RESET_CODE_TTL_MIN: 15,
    RESET_SESSION_TTL_MIN: 5,
    RESET_CODE_MAX_ATTEMPTS: 5,
    FORGOT_RATE_LIMIT_MAX: 1000,
    FORGOT_RATE_LIMIT_WINDOW_MS: 60_000,
    VERIFY_RATE_LIMIT_MAX: 1000,
    VERIFY_RATE_LIMIT_WINDOW_MS: 60_000,
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'admin123',
    ADMIN_EMAIL: 'admin@chess.test',
    ADMIN_SESSION_TTL_HOURS: 12,
    SMTP_PORT: 465,
    SMTP_SECURE: true,
    APP_PUBLIC_NAME: 'אני מפלצת שחמט!',
    ...(opts.envOverrides ?? {}),
  };

  const app = createApp({
    env,
    version: 'test',
    authService,
    progressService,
    setupService,
    adminService,
    passwordResetService,
  });

  return {
    app,
    authService,
    progressService,
    setupService,
    adminService,
    passwordResetService,
    usersRepo,
    progressRepo,
    sessionsRepo,
    resetCodesRepo,
    resetSessionsRepo,
    passwordService,
    seedService,
    emailService,
    db,
    closeDb: () => db.close(),
  };
}

export { ConsoleEmailService };
