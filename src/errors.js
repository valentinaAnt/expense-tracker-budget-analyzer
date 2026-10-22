/**
 * An error that is safe to show to the client, with an HTTP status and a machine-readable code.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  /** @param {{ field: string, message: string }[]} details */
  constructor(details, message = 'Invalid request data') {
    super(400, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

/** Answers unknown /api routes with JSON instead of Express's default HTML page. */
export function apiNotFound(req, res, next) {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
}

/**
 * Central error handler: every error leaves the server in the same JSON shape.
 * Unexpected errors (including database errors) are logged but never exposed in detail.
 * Express recognises error handlers by their four parameters, so `next` must stay in the signature.
 */
export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof AppError) {
    const body = { code: error.code, message: error.message };
    if (error.details) body.details = error.details;
    return res.status(error.status).json({ error: body });
  }

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }

  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
  }

  console.error(error);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
}
