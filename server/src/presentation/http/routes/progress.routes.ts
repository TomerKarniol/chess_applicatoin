import { Router, type RequestHandler } from 'express';
import type { ProgressService } from '../../../application/services/progress.service.js';
import { progressBodySchema } from '../validators/progress.schema.js';
import { shouldUnlockAllModules } from '../../../domain/progress.js';
import { UnauthenticatedError } from '../../../shared/errors.js';

export interface ProgressRouterDeps {
  progressService: ProgressService;
  requireAuth: RequestHandler;
  requireCompletedSetup: RequestHandler;
}

export function buildProgressRouter(deps: ProgressRouterDeps): Router {
  const router = Router();

  // Every progress endpoint requires both an authenticated session AND a
  // user who has finished first-time setup.
  router.use('/progress', deps.requireAuth, deps.requireCompletedSetup);

  router.get('/progress', (req, res, next) => {
    try {
      if (!req.auth) throw new UnauthenticatedError();
      const snapshot = deps.progressService.getForUser(
        req.auth.user.id,
        shouldUnlockAllModules(req.auth.user),
      );
      res.status(200).json(snapshot);
    } catch (err) {
      next(err);
    }
  });

  router.put('/progress', (req, res, next) => {
    try {
      if (!req.auth) throw new UnauthenticatedError();
      const parsed = progressBodySchema.parse(req.body);
      deps.progressService.saveForUser(req.auth.user.id, parsed);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.post('/progress/reset', (req, res, next) => {
    try {
      if (!req.auth) throw new UnauthenticatedError();
      deps.progressService.resetForUser(req.auth.user.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
