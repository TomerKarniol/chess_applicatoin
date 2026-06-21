import { resolve } from 'node:path';
import express, {
  type Express,
  type Request,
  type RequestHandler,
  type Response,
  type NextFunction,
} from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import pinoHttp from 'pino-http';

import type { Env } from '../../config/env.js';
import { getLogger } from '../../shared/logger.js';
import { requestIdMiddleware, REQUEST_ID_HEADER } from './middleware/request-id.js';
import {
  CSRF_COOKIE_NAME,
  issueCsrfMiddleware,
  verifyCsrfMiddleware,
} from './middleware/csrf.js';
import { requireAuthMiddleware } from './middleware/require-auth.js';
import { requireCompletedSetupMiddleware } from './middleware/require-completed-setup.js';
import { requireAdminMiddleware } from './middleware/require-admin.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { buildHealthRouter } from './routes/health.routes.js';
import { buildCsrfRouter } from './routes/csrf.routes.js';
import { buildAuthRouter } from './routes/auth.routes.js';
import { buildProgressRouter } from './routes/progress.routes.js';
import { buildPasswordResetRouter } from './routes/password-reset.routes.js';
import { buildAdminRouter } from './routes/admin.routes.js';
import { SESSION_COOKIE_NAME } from '../../domain/session.js';

import type { AuthService } from '../../application/services/auth.service.js';
import type { ProgressService } from '../../application/services/progress.service.js';
import type { SetupService } from '../../application/services/setup.service.js';
import type { AdminService } from '../../application/services/admin.service.js';
import type { PasswordResetService } from '../../application/services/password-reset.service.js';

export interface AppDeps {
  env: Env;
  version: string;
  authService: AuthService;
  progressService: ProgressService;
  setupService: SetupService;
  adminService: AdminService;
  passwordResetService: PasswordResetService;
}

function asHandler(mw: unknown): RequestHandler {
  return mw as RequestHandler;
}

export function createApp(deps: AppDeps): Express {
  const { env } = deps;
  const isProd = env.NODE_ENV === 'production';
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', isProd ? 1 : false);

  app.use(requestIdMiddleware());
  app.use(
    asHandler(
      pinoHttp({
        logger: getLogger(),
        genReqId: (req) => (req as Request).id ?? '-',
        customLogLevel: (_req, res, err) => {
          if (err || res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
        customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
        customErrorMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
      }),
    ),
  );
  app.use(
    asHandler(
      helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
      }),
    ),
  );
  app.use(asHandler(cookieParser(env.COOKIE_SECRET)));
  app.use(asHandler(express.json({ limit: '16kb' })));
  app.use(asHandler(express.urlencoded({ extended: false, limit: '16kb' })));

  const cookieOptions = {
    secure: isProd,
    sameSite: 'lax' as const,
  };
  app.use(issueCsrfMiddleware(cookieOptions));

  app.use(buildHealthRouter(deps.version));

  const api = express.Router();
  api.use(verifyCsrfMiddleware());
  api.use(buildCsrfRouter());

  const requireAuth = requireAuthMiddleware(deps.authService);
  const requireCompletedSetup = requireCompletedSetupMiddleware();
  const requireAdmin = requireAdminMiddleware();

  const loginLimiter = rateLimit({
    windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
    limit: env.LOGIN_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'rate_limited',
          message: 'Too many login attempts. Please wait a few minutes and try again.',
        },
      });
    },
  });
  api.use('/auth/login', loginLimiter);

  const forgotLimiter = rateLimit({
    windowMs: env.FORGOT_RATE_LIMIT_WINDOW_MS,
    limit: env.FORGOT_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'rate_limited',
          message: 'Too many password reset requests. Please wait and try again.',
        },
      });
    },
  });
  api.use('/auth/forgot-password', forgotLimiter);

  const verifyLimiter = rateLimit({
    windowMs: env.VERIFY_RATE_LIMIT_WINDOW_MS,
    limit: env.VERIFY_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'rate_limited',
          message: 'Too many code verification attempts. Please wait and try again.',
        },
      });
    },
  });
  api.use('/auth/verify-reset-code', verifyLimiter);

  api.use(
    buildAuthRouter({
      authService: deps.authService,
      setupService: deps.setupService,
      requireAuth,
      sessionCookie: cookieOptions,
    }),
  );
  api.use(
    buildPasswordResetRouter({
      passwordResetService: deps.passwordResetService,
      resetCookieOptions: cookieOptions,
    }),
  );
  api.use(buildProgressRouter({ progressService: deps.progressService, requireAuth, requireCompletedSetup }));
  api.use(buildAdminRouter({ adminService: deps.adminService, requireAuth, requireAdmin }));

  app.use('/api/v1', api);

  const staticRoot = resolve(env.STATIC_ROOT);

  app.get('/', (req: Request, res: Response, next: NextFunction) => {
    try {
      const cookies = req.cookies as Record<string, string | undefined> | undefined;
      const sid = cookies?.[SESSION_COOKIE_NAME];
      const resolved = deps.authService.resolveSession(sid);
      if (!resolved) {
        res.redirect(302, '/auth/login.html');
        return;
      }
      if (resolved.user.mustChangePassword) {
        res.redirect(302, '/auth/setup.html');
        return;
      }
      res.redirect(302, '/' + encodeURIComponent('מסך הפתיחה') + '/index.html');
    } catch (err) {
      next(err);
    }
  });

  app.use(
    asHandler(
      express.static(staticRoot, {
        extensions: ['html'],
        fallthrough: true,
        etag: true,
        lastModified: true,
        maxAge: isProd ? '1h' : 0,
        setHeaders: (res, filePath) => {
          // HTML documents must always be revalidated. The frontend has no
          // cache-busting (no hashed filenames), so a cached page would keep
          // serving stale markup for up to `maxAge` — which is exactly how a
          // device ended up running an old roadmap without the per-user
          // progress sync scripts, falling back to its own localStorage and
          // showing modules locked/unlocked inconsistently across devices.
          // `no-cache` still allows cheap 304s via ETag/Last-Modified; it only
          // forces the browser to check freshness before reusing the document.
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    ),
  );

  app.use(notFoundHandler());
  app.use(errorHandler(isProd));

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Expose-Headers', REQUEST_ID_HEADER);
    next();
  });

  app.locals.cookieNames = {
    session: SESSION_COOKIE_NAME,
    csrf: CSRF_COOKIE_NAME,
  };

  return app;
}
