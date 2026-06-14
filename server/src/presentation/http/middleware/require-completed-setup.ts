import type { NextFunction, Request, Response } from 'express';
import { AppError, UnauthenticatedError } from '../../../shared/errors.js';

/**
 * Gates endpoints behind a real, fully-set-up user. The env-admin is NOT
 * a real player and has no per-user progress, so they are also blocked
 * here — admin-only operations belong under /admin/* with requireAdmin.
 *
 * Must run AFTER requireAuth — relies on `req.auth` being set.
 */
export function requireCompletedSetupMiddleware() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new UnauthenticatedError());
      return;
    }
    if (req.auth.kind === 'admin') {
      next(
        new AppError({
          statusCode: 403,
          code: 'forbidden',
          message: 'The env-admin account is not a player and has no progress.',
          details: { reason: 'admin_not_player' },
        }),
      );
      return;
    }
    if (req.auth.user.mustChangePassword) {
      next(
        new AppError({
          statusCode: 403,
          code: 'forbidden',
          message: 'Account setup required before continuing.',
          details: { reason: 'setup_required' },
        }),
      );
      return;
    }
    next();
  };
}
