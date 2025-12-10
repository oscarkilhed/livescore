/**
 * Custom error classes for better error handling and debugging
 */

/**
 * Base error class for application-specific errors
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error thrown when parsing fails
 */
export class ParseError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 'PARSE_ERROR', 500, cause);
  }
}

/**
 * Error thrown when fetching from external API fails
 */
export class FetchError extends AppError {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    cause?: unknown
  ) {
    super(message, 'FETCH_ERROR', statusCode, cause);
  }
}

/**
 * Error thrown when validation fails
 */
export class ValidationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, cause);
  }
}

/**
 * Error thrown when a feature is disabled
 */
export class FeatureDisabledError extends AppError {
  constructor(featureName: string) {
    super(`Feature '${featureName}' is disabled`, 'FEATURE_DISABLED', 403);
  }
}
