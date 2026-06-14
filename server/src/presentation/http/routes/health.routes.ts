import { Router } from 'express';

export function buildHealthRouter(version: string): Router {
  const router = Router();
  router.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true, version });
  });
  return router;
}
