import { Router } from 'express';
import { CSRF_COOKIE_NAME } from '../middleware/csrf.js';

export function buildCsrfRouter(): Router {
  const router = Router();
  // The issueCsrfMiddleware that runs upstream already ensures a cookie is set.
  // This endpoint just lets the client read the token back as JSON, which is
  // convenient when SameSite restrictions hide the Set-Cookie response from JS.
  router.get('/csrf-token', (req, res) => {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const token = cookies?.[CSRF_COOKIE_NAME];
    res.status(200).json({ token: token ?? null });
  });
  return router;
}
