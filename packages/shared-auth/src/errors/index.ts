import type { Response } from 'express';

/**
 * Standardized service error class for use across all apps in the monorepo.
 * Based on the ServiceResponseError pattern from apps/js-tools.
 */
export class ServiceError extends Error {
    statusCode: number;
    code: string;
    originalError?: Error;

    constructor(statusCode: number, code: string, message: string, originalError?: Error) {
        super(message);
        this.name = 'ServiceError';
        this.statusCode = statusCode;
        this.code = code;
        this.originalError = originalError;
    }

    /**
     * Factory for 400 Bad Request errors.
     */
    static badRequest(message: string, code = 'BAD_REQUEST'): ServiceError {
        return new ServiceError(400, code, message);
    }

    /**
     * Factory for 401 Unauthorized errors.
     */
    static unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED'): ServiceError {
        return new ServiceError(401, code, message);
    }

    /**
     * Factory for 403 Forbidden errors.
     */
    static forbidden(message = 'Forbidden', code = 'FORBIDDEN'): ServiceError {
        return new ServiceError(403, code, message);
    }

    /**
     * Factory for 404 Not Found errors.
     */
    static notFound(message: string, code = 'NOT_FOUND'): ServiceError {
        return new ServiceError(404, code, message);
    }

    /**
     * Factory for 500 Internal Server Error.
     */
    static internal(message: string, originalError?: Error): ServiceError {
        return new ServiceError(500, 'INTERNAL_ERROR', message, originalError);
    }

    /**
     * Wraps an unknown error into a ServiceError, preserving it if already one.
     */
    static from(error: unknown): ServiceError {
        if (error instanceof ServiceError) {
            return error;
        }

        if (error instanceof Error) {
            return new ServiceError(500, 'INTERNAL_ERROR', error.message, error);
        }

        if (typeof error === 'string') {
            return new ServiceError(500, 'INTERNAL_ERROR', error);
        }

        return new ServiceError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    }
}

/**
 * Handles controller-level errors by sending a consistent JSON response.
 *
 * - If the error is a ServiceError, uses its statusCode and code.
 * - Otherwise, logs the full error and responds with 500.
 * - Always returns { error: string, message: string }.
 *
 * @param res - Express response object
 * @param error - The caught error (unknown type)
 * @param defaultMessage - Fallback message for non-ServiceError errors (default: 'Internal Server Error')
 */
export function handleControllerError(
    res: Response,
    error: unknown,
    defaultMessage = 'Internal Server Error'
): Response {
    if (error instanceof ServiceError) {
        return res.status(error.statusCode).json({
            error: error.code,
            message: error.message,
        });
    }

    // Log the full error for non-ServiceError cases
    console.error(`[Controller Error]`, error);

    const message = error instanceof Error ? error.message : defaultMessage;

    return res.status(500).json({
        error: 'INTERNAL_ERROR',
        message,
    });
}
