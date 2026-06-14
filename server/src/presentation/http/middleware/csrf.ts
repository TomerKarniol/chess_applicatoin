import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { CsrfError } from '../../../shared/errors.js';

export const CSRF_COOKIE_NAME = 'chess_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const TOKEN_BYTES = 32;

export interface CsrfCookieOptions {
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path?: string;
}

function isStateChanging(req: Request): boolean {
  const m = req.method.toUpperCase();
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
}

/**
 * Issue or refresh the CSRF cookie. The cookie value IS the token (double-submit
 * pattern). On every state-changing request we compare the cookie value against
 * the X-CSRF-Token header in constant time. Same-origin only — no need to mint
 * a per-form token.
 */
export function issueCsrfMiddleware(cookieOptions: CsrfCookieOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const existing = cookies?.[CSRF_COOKIE_NAME];
    if (!existing || !/^[a-f0-9]{64}$/.test(existing)) {
      const token = randomBytes(TOKEN_BYTES).toString('hex');
      res.cookie(CSRF_COOKIE_NAME, token, {
        httpOnly: false, // readable by client JS — that's the whole point of double-submit
        secure: cookieOptions.secure,
        sameSite: cookieOptions.sameSite,
        path: cookieOptions.path ?? '/',
      });
      // Make the freshly-set token visible to the rest of this request chain.
      (req.cookies as Record<string, string>)[CSRF_COOKIE_NAME] = token;
    }
    next();
  };
}

/**
 * Reject state-changing requests whose header token does not match the cookie.
 * Order: issue middleware must run before this one.
 */
export function verifyCsrfMiddleware(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!isStateChanging(req)) {
      next();
      return;
    }
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const cookieToken = cookies?.[CSRF_COOKIE_NAME];
    const headerToken = req.header(CSRF_HEADER_NAME);
    if (!cookieToken || !headerToken || cookieToken.length !== headerToken.length) {
      next(new CsrfError());
      return;
    }
    const a = Buffer.from(cookieToken, 'utf8');
    const b = Buffer.from(headerToken, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      next(new CsrfError());
      return;
    }
    next();
  };
}
