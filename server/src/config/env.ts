import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  COOKIE_SECRET: z
    .string()
    .min(16, 'COOKIE_SECRET must be at least 16 characters'),
  DB_PATH: z.string().default('./data/chess.db'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  STATIC_ROOT: z.string().default('..'),

  // ── Password reset ──────────────────────────────────────────────────
  RESET_CODE_TTL_MIN: z.coerce.number().int().positive().default(15),
  RESET_SESSION_TTL_MIN: z.coerce.number().int().positive().default(5),
  RESET_CODE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  FORGOT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  FORGOT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  VERIFY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  VERIFY_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),

  // ── Operator admin (.env-based, NOT stored in DB) ───────────────────
  // The admin user is whoever can present these credentials at /auth/login.
  // No row exists in `users`. Sessions are kept in memory and clear on
  // server restart. To rotate, edit .env and restart.
  ADMIN_USERNAME: z.string().min(1).max(64).default('admin'),
  ADMIN_PASSWORD: z.string().min(1).max(256).optional(),
  ADMIN_EMAIL: z.string().max(254).optional(),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),

  // ── Email (SMTP — leave SMTP_HOST blank to use the dev console transport) ──
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .default(true),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  APP_PUBLIC_NAME: z.string().default('אני מפלצת שחמט!'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  // Allow tests / scripts to skip the secret check by providing a sane default.
  const withDefaults = {
    COOKIE_SECRET:
      source.COOKIE_SECRET ??
      (source.NODE_ENV === 'production' ? undefined : 'dev-cookie-secret-please-override'),
    ...source,
    // Back-compat: the env-admin model uses ADMIN_USERNAME / ADMIN_PASSWORD,
    // but older .env files used ADMIN_INITIAL_USERNAME / ADMIN_INITIAL_PASSWORD
    // when admin was DB-seeded. Honor the legacy names if the new ones are blank.
    ADMIN_USERNAME: source.ADMIN_USERNAME ?? source.ADMIN_INITIAL_USERNAME ?? 'admin',
    ADMIN_PASSWORD: source.ADMIN_PASSWORD ?? source.ADMIN_INITIAL_PASSWORD,
  } as NodeJS.ProcessEnv;
  const parsed = envSchema.safeParse(withDefaults);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvForTests(): void {
  cached = undefined;
}
