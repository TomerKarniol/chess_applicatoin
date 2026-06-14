// Silence the logger before any module loads it. Vitest evaluates this file
// before the test files (see vitest.config.ts → `setupFiles`).
process.env.LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECRET ??= 'test-cookie-secret-please-override-1234';
