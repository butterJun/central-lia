/**
 * Application errors carry an HTTP status and a message that is safe to show
 * to the user. Anything else reaching the HTTP layer is treated as a 500.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404, 'not_found');
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(message, 403, 'forbidden');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'conflict', details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'validation_error', details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message: string) {
    super(message, 401, 'unauthenticated');
  }
}

const MAX_ERROR_CHARS = 300;

/** Error text safe to store and show: no URLs (may carry tokens), no key=value secrets, bounded length. */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const scrubbed = raw
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/\b(access_token|refresh_token|client_secret|api[_-]?key|token|code)=\S+/gi, '$1=[oculto]')
    .replace(/\b(sk-ant-[\w-]+|ya29\.[\w.-]+)/g, '[oculto]');
  return scrubbed.length > MAX_ERROR_CHARS ? `${scrubbed.slice(0, MAX_ERROR_CHARS)}…` : scrubbed;
}
