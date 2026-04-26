import { z } from 'zod';

import { ERROR_CODE } from '../enums/error-code';
import type { ResponseCode } from '../enums/response-code';

export const ApiErrorSchema = z.object({
    code: z.nativeEnum(ERROR_CODE),
    message: z.string(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export interface ApiResponse<T> {
    data: T;
    meta?: Record<string, unknown>;
}

export interface ApiMessageResponse {
    data: {
        code: ResponseCode;
        message: string;
    };
    meta?: Record<string, unknown>;
}
