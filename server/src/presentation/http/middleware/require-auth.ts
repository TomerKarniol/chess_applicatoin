import type { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE_NAME, type Session } from '../../../domain/session.js';
import { UnauthenticatedError } from '../../../shared/errors.js';
import type { User } from '../../../domain/user.js';
import type { AuthService } from '../../../application/services/auth.service.js';
import {
  ADMIN_SESSION_COOKIE_NAME,
  type AdminSession,
} from '../../../application/services/env-admin.service.js';

declare module 'express-serve-static-core' {
  interface Request {
    auth?:
      | { kind: 'user'; user: User; session: Session }
      | { kind: 'admin'; user: User; session: AdminSession };
  }
}

export function requireAuthMiddleware(authService: AuthService) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const userSid = cookies?.[SESSION_COOKIE_NAME];
    const adminSid = cookies?.[ADMIN_SESSION_COOKIE_NAME];
    const resolved = authService.resolveAnySession(userSid, adminSid);
    if (!resolved) {
      next(new UnauthenticatedError());
      return;
    }
    req.auth = resolved;
    next();
  };
}
