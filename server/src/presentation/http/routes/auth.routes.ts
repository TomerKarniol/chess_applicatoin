import { Router, type RequestHandler } from 'express';
import type { AuthService } from '../../../application/services/auth.service.js';
import type { SetupService } from '../../../application/services/setup.service.js';
import { loginBodySchema } from '../validators/auth.schema.js';
import { setupBodySchema } from '../validators/setup.schema.js';
import { SESSION_COOKIE_NAME } from '../../../domain/session.js';
import {
  ADMIN_SESSION_COOKIE_NAME,
  EnvAdminService,
} from '../../../application/services/env-admin.service.js';
import { AppError, UnauthenticatedError } from '../../../shared/errors.js';

export interface AuthRouterDeps {
  authService: AuthService;
  setupService: SetupService;
  requireAuth: RequestHandler;
  sessionCookie: {
    secure: boolean;
    sameSite: 'lax' | 'strict' | 'none';
  };
}

export function buildAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router();

  router.post('/auth/login', (req, res, next) => {
    (async () => {
      const parsed = loginBodySchema.parse(req.body);
      const result = await deps.authService.login(parsed.username, parsed.password);

      if (result.kind === 'admin') {
        res.cookie(ADMIN_SESSION_COOKIE_NAME, result.session.id, {
          httpOnly: true,
          secure: deps.sessionCookie.secure,
          sameSite: deps.sessionCookie.sameSite,
          path: '/',
          expires: new Date(result.session.expiresAt),
        });
        // Defensive: if the browser still holds a stale user-session cookie
        // (e.g., logging in as admin from a player's browser), clear it.
        res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
      } else {
        res.cookie(SESSION_COOKIE_NAME, result.session.id, {
          httpOnly: true,
          secure: deps.sessionCookie.secure,
          sameSite: deps.sessionCookie.sameSite,
          path: '/',
          expires: new Date(result.session.expiresAt),
        });
        res.clearCookie(ADMIN_SESSION_COOKIE_NAME, { path: '/' });
      }

      res.status(200).json({
        user: result.user,
        mustChangePassword: result.mustChangePassword,
      });
    })().catch(next);
  });

  router.post('/auth/logout', (req, res, next) => {
    try {
      const cookies = req.cookies as Record<string, string | undefined> | undefined;
      const userSid = cookies?.[SESSION_COOKIE_NAME];
      const adminSid = cookies?.[ADMIN_SESSION_COOKIE_NAME];
      if (userSid) deps.authService.logout(userSid);
      if (adminSid) deps.authService.logoutAdmin(adminSid);
      res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
      res.clearCookie(ADMIN_SESSION_COOKIE_NAME, { path: '/' });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.get('/auth/me', deps.requireAuth, (req, res, next) => {
    try {
      if (!req.auth) throw new UnauthenticatedError();
      res.status(200).json({
        user: req.auth.user,
        mustChangePassword: req.auth.user.mustChangePassword,
      });
    } catch (err) {
      next(err);
    }
  });

  // ──────────────────────────────
  //  First-time setup completion.
  //  Reserved for real DB users. The env-admin has no first-time setup —
  //  attempting it is a 400 so the misuse is loud.
  // ──────────────────────────────
  router.post('/auth/complete-setup', deps.requireAuth, (req, res, next) => {
    (async () => {
      if (!req.auth) throw new UnauthenticatedError();
      if (req.auth.kind === 'admin' || EnvAdminService.isEnvAdminUserId(req.auth.user.id)) {
        throw new AppError({
          statusCode: 400,
          code: 'forbidden',
          message: 'The env-admin account has no first-time setup. Edit .env to change the password.',
        });
      }
      const parsed = setupBodySchema.parse(req.body);
      const user = await deps.setupService.completeFirstTimeSetup(req.auth.user.id, parsed);
      res.status(200).json({ user, mustChangePassword: user.mustChangePassword });
    })().catch(next);
  });

  return router;
}
