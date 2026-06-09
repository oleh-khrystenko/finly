import { RESPONSE_CODE, type ResponseCode } from './response-code';

/**
 * @deprecated Use RESPONSE_CODE instead. Kept for backward compatibility with AllExceptionsFilter.
 */
export const ERROR_CODE = {
    ACCOUNT_DELETED: RESPONSE_CODE.ACCOUNT_DELETED,
    UNAUTHORIZED: RESPONSE_CODE.UNAUTHORIZED,
    VALIDATION_ERROR: RESPONSE_CODE.VALIDATION_ERROR,
    NOT_FOUND: RESPONSE_CODE.NOT_FOUND,
    RATE_LIMIT_EXCEEDED: RESPONSE_CODE.RATE_LIMIT_EXCEEDED,
    INTERNAL_ERROR: RESPONSE_CODE.INTERNAL_ERROR,
} as const;

/**
 * @deprecated Use ResponseCode instead.
 */
export type ErrorCode = ResponseCode;
