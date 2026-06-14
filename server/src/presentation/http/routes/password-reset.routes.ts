import { Router } from 'express';
import { RESET_SESSION_COOKIE_NAME } from '../../../domain/reset-code.js';
import { AppError } from '../../../shared/errors.js';
import type {
  InvalidResetReason,
  PasswordResetService,
} from '../../../application/services/password-reset.service.js';
import {
  forgotBodySchema,
  resetBodySchema,
  verifyBodySchema,
} from '../validators/password-reset.schema.js';

/** Map a verify-code failure reason to a specific, user-actionable HTTP error. */
function verifyErrorFor(reason: InvalidResetReason): AppError {
  switch (reason) {
    case 'expired':
      return new AppError({
        statusCode: 400,
        code: 'validation_failed',
        message: 'This code has expired. Please request a new one.',
        details: { reason: 'code_expired' },
      });
    case 'locked':
      return new AppError({
        statusCode: 429,
        code: 'rate_limited',
        message: 'Too many incorrect attempts. Please request a new code.',
        details: { reason: 'too_many_attempts' },
      });
    case 'no_request':
      return new AppError({
        statusCode: 400,
        code: 'validation_failed',
        message: 'No active reset request. Please request a new code first.',
        details: { reason: 'no_active_request' },
      });
    case 'wrong_code':
    default:
      return new AppError({
        statusCode: 400,
        code: 'validation_failed',
        message: 'Incorrect code. Please check it and try again.',
        details: { reason: 'invalid_code' },
      });
  }
}

export interface PasswordResetRouterDeps {
  passwordResetService: PasswordResetService;
  resetCookieOptions: {
    secure: boolean;
    sameSite: 'lax' | 'strict' | 'none';
  };
}

export function buildPasswordResetRouter(deps: PasswordResetRouterDeps): Router {
  const router = Router();

  // ──────────────────────────────
  //  POST /auth/forgot-password
  //  204 on success. Reports clear errors (404 unknown account, 409 no email
  //  on file, 502 email send failure) — the route's rate limiter blunts abuse.
  // ──────────────────────────────
  router.post('/auth/forgot-password', (req, res, next) => {
    (async () => {
      const parsed = forgotBodySchema.parse(req.body);
      await deps.passwordResetService.request(parsed.identifier);
      res.status(204).send();
    })().catch(next);
  });

  // ──────────────────────────────
  //  POST /auth/verify-reset-code
  //  On success → 200, sets HttpOnly reset cookie.
  //  On failure → a specific error so the UI can guide the user:
  //    no_request/expired/wrong_code → 400, locked → 429.
  // ──────────────────────────────
  router.post('/auth/verify-reset-code', (req, res, next) => {
    (async () => {
      const parsed = verifyBodySchema.parse(req.body);
      const result = await deps.passwordResetService.verify(parsed.identifier, parsed.code);
      if (result.outcome === 'invalid') {
        throw verifyErrorFor(result.reason);
      }
      res.cookie(RESET_SESSION_COOKIE_NAME, result.session.id, {
        httpOnly: true,
        secure: deps.resetCookieOptions.secure,
        sameSite: deps.resetCookieOptions.sameSite,
        path: '/',
        expires: new Date(result.session.expiresAt),
      });
      res.status(200).json({ ok: true });
    })().catch(next);
  });

  // ──────────────────────────────
  //  POST /auth/reset-password
  //  Requires the reset cookie; consumes it on success.
  // ──────────────────────────────
  router.post('/auth/reset-password', (req, res, next) => {
    (async () => {
      const parsed = resetBodySchema.parse(req.body);
      const cookies = req.cookies as Record<string, string | undefined> | undefined;
      const sid = cookies?.[RESET_SESSION_COOKIE_NAME];
      if (!sid) {
        throw new AppError({
          statusCode: 401,
          code: 'unauthenticated',
          message: 'No active reset session. Please verify a code first.',
        });
      }
      await deps.passwordResetService.reset(sid, parsed.newPassword, parsed.confirmPassword);
      res.clearCookie(RESET_SESSION_COOKIE_NAME, { path: '/' });
      res.status(204).send();
    })().catch(next);
  });

  return router;
}
