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
 * Error thrown when GraphQL API request fails
 */
export class GraphQLError extends AppError {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    cause?: unknown
  ) {
    super(message, 'GRAPHQL_ERROR', statusCode, cause);
  }
}

/**
 * Error thrown when the event has scores but the organizer has restricted them
 * to organizers only, so the API returns an empty scorecard list.
 *
 * Detected when a stage's `scorecards_count` is greater than zero while the
 * `scorecards` list comes back empty (see graphql.ts). Surfaced to the client
 * so it can explain the blank state instead of showing an empty results view.
 */
export class ResultsRestrictedError extends AppError {
  constructor(message: string) {
    super(message, 'RESULTS_RESTRICTED', 403);
  }
}
