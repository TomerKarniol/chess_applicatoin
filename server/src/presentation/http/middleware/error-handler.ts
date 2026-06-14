import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, ValidationError } from '../../../shared/errors.js';
import { childLogger } from '../../../shared/logger.js';

const log = childLogger({ component: 'error-handler' });

export function notFoundHandler() {
  return (req: Request, res: Response): void => {
    res.status(404).json({
      error: { code: 'not_found', message: `No route matched ${req.method} ${req.originalUrl}` },
    });
  };
}

export function errorHandler(isProduction: boolean) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const requestId = req.id;

    if (err instanceof ZodError) {
      const v = new ValidationError(err.flatten());
      log.warn({ requestId, code: v.code }, v.message);
      res.status(v.statusCode).json(v.toBody());
      return;
    }

    if (err instanceof AppError) {
      if (err.statusCode >= 500) {
        log.error({ requestId, code: err.code, err }, err.message);
      } else {
        log.warn({ requestId, code: err.code }, err.message);
      }
      res.status(err.statusCode).json(err.toBody());
      return;
    }

    // Unknown error — never leak stack/details in production.
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error({ requestId, err }, `unhandled: ${message}`);
    res.status(500).json({
      error: {
        code: 'internal_error',
        message: isProduction ? 'Internal server error.' : message,
      },
    });
  };
}
