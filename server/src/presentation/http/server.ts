import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../../config/env.js';
import { getLogger } from '../../shared/logger.js';
import { openDb } from '../../infrastructure/db/connection.js';
import { runMigrations } from '../../infrastructure/db/migrator.js';
import { UsersRepository } from '../../infrastructure/repositories/users.repository.js';
import { ProgressRepository } from '../../infrastructure/repositories/progress.repository.js';
import { SessionsRepository } from '../../infrastructure/repositories/sessions.repository.js';
import { ResetCodesRepository } from '../../infrastructure/repositories/reset-codes.repository.js';
import { ResetSessionsRepository } from '../../infrastructure/repositories/reset-sessions.repository.js';
import { Argon2PasswordService } from '../../application/services/password.service.js';
import { AuthService } from '../../application/services/auth.service.js';
import { ProgressService } from '../../application/services/progress.service.js';
import { SeedService } from '../../application/services/seed.service.js';
import { SetupService } from '../../application/services/setup.service.js';
import { AdminService } from '../../application/services/admin.service.js';
import { PasswordResetService } from '../../application/services/password-reset.service.js';
import { EnvAdminService } from '../../application/services/env-admin.service.js';
import { buildEmailService } from '../../application/services/email.service.js';
import { createApp } from './app.js';

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, '..', '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const log = getLogger();
  const version = readVersion();

  log.info({ NODE_ENV: env.NODE_ENV, port: env.PORT, dbPath: env.DB_PATH, version }, 'starting');

  const db = openDb(env.DB_PATH);

  const migrationResult = runMigrations(db);
  log.info({ migrationResult }, 'migrations done');

  const usersRepo = new UsersRepository(db);
  const progressRepo = new ProgressRepository(db);
  const sessionsRepo = new SessionsRepository(db);
  const resetCodesRepo = new ResetCodesRepository(db);
  const resetSessionsRepo = new ResetSessionsRepository(db);

  const passwordService = new Argon2PasswordService();
  const emailService = buildEmailService(env);
  log.info({ transport: emailService.transportName }, 'email transport selected');
  try {
    await emailService.verify();
    log.info({ transport: emailService.transportName }, 'email transport verified');
  } catch (err) {
    // Non-fatal: the app still serves so lessons/auth keep working, but we make
    // the failure impossible to miss so a typo'd SMTP_HOST is caught at boot
    // rather than silently breaking every password-reset email.
    log.error(
      { err, transport: emailService.transportName },
      'EMAIL TRANSPORT VERIFICATION FAILED — password-reset emails will NOT be delivered. Check SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS in .env (common cause: a misspelled host such as "smpt.gmail.com" instead of "smtp.gmail.com").',
    );
  }

  const envAdminService = new EnvAdminService({
    username: env.ADMIN_USERNAME,
    password: env.ADMIN_PASSWORD,
    email: env.ADMIN_EMAIL ?? null,
    sessionTtlHours: env.ADMIN_SESSION_TTL_HOURS,
  });
  log.info(
    { enabled: envAdminService.isEnabled(), username: env.ADMIN_USERNAME },
    'env-admin path configured',
  );

  const authService = new AuthService({
    usersRepo,
    sessionsRepo,
    passwordService,
    envAdminService,
    sessionTtlDays: env.SESSION_TTL_DAYS,
  });
  const progressService = new ProgressService(progressRepo);
  const setupService = new SetupService({ usersRepo, passwordService });
  const adminService = new AdminService({ usersRepo, sessionsRepo, passwordService });
  const passwordResetService = new PasswordResetService({
    usersRepo,
    resetCodesRepo,
    resetSessionsRepo,
    sessionsRepo,
    passwordService,
    emailService,
    codeTtlMinutes: env.RESET_CODE_TTL_MIN,
    resetSessionTtlMinutes: env.RESET_SESSION_TTL_MIN,
    maxAttempts: env.RESET_CODE_MAX_ATTEMPTS,
    appPublicName: env.APP_PUBLIC_NAME,
  });

  const seedService = new SeedService({ usersRepo, progressRepo, passwordService });
  const seedResult = await seedService.seed();
  log.info({ seedResult }, 'seed done');

  const app = createApp({
    env,
    version,
    authService,
    progressService,
    setupService,
    adminService,
    passwordResetService,
  });

  const server = app.listen(env.PORT, () => {
    log.info({ port: env.PORT }, 'listening');
  });

  const cleanupInterval = setInterval(
    () => {
      const removed = sessionsRepo.deleteExpired();
      const pruned = passwordResetService.pruneExpired();
      const prunedAdmin = envAdminService.pruneExpired();
      if (removed > 0 || pruned.codes > 0 || pruned.sessions > 0 || prunedAdmin > 0) {
        log.info({ removed, pruned, prunedAdmin }, 'periodic cleanup');
      }
    },
    60 * 60 * 1000,
  );
  cleanupInterval.unref();

  const shutdown = (signal: string): void => {
    log.info({ signal }, 'shutting down');
    clearInterval(cleanupInterval);
    server.close((err) => {
      if (err) log.error({ err }, 'http close error');
      try {
        db.close();
      } catch (closeErr) {
        log.error({ closeErr }, 'db close error');
      }
      process.exit(err ? 1 : 0);
    });
    setTimeout(() => {
      log.error('forced exit after shutdown timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
