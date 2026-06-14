import type { NextFunction, Request, Response } from 'express';
import { AppError, UnauthenticatedError } from '../../../shared/errors.js';

/**
 * Gates endpoints behind an admin user. Must run after requireAuth.
 */
export function requireAdminMiddleware() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new UnauthenticatedError());
      return;
    }
    if (!req.auth.user.isAdmin) {
      next(
        new AppError({
          statusCode: 403,
          code: 'forbidden',
          message: 'Admin privileges required.',
        }),
      );
      return;
    }
    next();
  };
}
