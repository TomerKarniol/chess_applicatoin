export type ErrorCode =
  | 'invalid_credentials'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'validation_failed'
  | 'rate_limited'
  | 'csrf_failed'
  | 'conflict'
  | 'internal_error';

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(opts: { statusCode: number; code: ErrorCode; message: string; details?: unknown }) {
    super(opts.message);
    this.name = 'AppError';
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    if (opts.details !== undefined) {
      this.details = opts.details;
    }
  }

  toBody(): ErrorBody {
    const body: ErrorBody = { error: { code: this.code, message: this.message } };
    if (this.details !== undefined) {
      body.error.details = this.details;
    }
    return body;
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    super({
      statusCode: 401,
      code: 'invalid_credentials',
      message: 'Invalid username or password.',
    });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required.') {
    super({ statusCode: 401, code: 'unauthenticated', message });
  }
}

export class CsrfError extends AppError {
  constructor(message = 'Invalid or missing CSRF token.') {
    super({ statusCode: 403, code: 'csrf_failed', message });
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown, message = 'Request validation failed.') {
    super({ statusCode: 400, code: 'validation_failed', message, details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found.') {
    super({ statusCode: 404, code: 'not_found', message });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict.') {
    super({ statusCode: 409, code: 'conflict', message });
  }
}
