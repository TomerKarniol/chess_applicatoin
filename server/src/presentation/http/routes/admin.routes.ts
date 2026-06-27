import { Router, type RequestHandler } from 'express';
import type { AdminService } from '../../../application/services/admin.service.js';
import {
  createStudentBodySchema,
  updateEmailBodySchema,
  userIdParamSchema,
} from '../validators/admin.schema.js';

export interface AdminRouterDeps {
  adminService: AdminService;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
}

export function buildAdminRouter(deps: AdminRouterDeps): Router {
  const router = Router();

  router.use(deps.requireAuth, deps.requireAdmin);

  router.get('/admin/users', (_req, res, next) => {
    try {
      const users = deps.adminService.listUsers();
      res.status(200).json({ users });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/users', (req, res, next) => {
    (async () => {
      const parsed = createStudentBodySchema.parse(req.body);
      const result = await deps.adminService.createStudent(parsed.username);
      res.status(201).json(result);
    })().catch(next);
  });

  router.post('/admin/users/:id/regenerate-password', (req, res, next) => {
    (async () => {
      const params = userIdParamSchema.parse(req.params);
      const result = await deps.adminService.regenerateTempPassword(params.id);
      res.status(200).json(result);
    })().catch(next);
  });

  router.put('/admin/users/:id/email', (req, res, next) => {
    try {
      const params = userIdParamSchema.parse(req.params);
      const body = updateEmailBodySchema.parse(req.body);
      const user = deps.adminService.updateStudentEmail(params.id, body.email);
      res.status(200).json({ user });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/admin/users/:id', (req, res, next) => {
    try {
      const params = userIdParamSchema.parse(req.params);
      deps.adminService.deleteStudent(params.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
