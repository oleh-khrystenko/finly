import { AxiosError } from 'axios';

/**
 * Витягає machine-readable `code` з API error-response envelope (`{error: {code}}`).
 *
 * API кидає errors через `AllExceptionsFilter` з shape `{error: {code, message}}`
 * у response body. Axios загортає це у `AxiosError.response.data`. Цей helper
 * читає `code` через safe-narrowing і повертає `'unknown'` як fallback —
 * frontend caller передає у `getApiMessage(code, module)` для UA-mapping.
 *
 * Парний до `getApiMessage` (`./mapApiCode.ts`) — getApiMessage перетворює code
 * у текст, extractApiErrorCode — витягає code з raw error.
 */
export function extractApiErrorCode(err: unknown): string {
    if (!(err instanceof AxiosError)) return 'unknown';
    const data = err.response?.data;
    if (!data || typeof data !== 'object') return 'unknown';
    const errorField = (data as { error?: unknown }).error;
    if (!errorField || typeof errorField !== 'object') return 'unknown';
    const code = (errorField as { code?: unknown }).code;
    return typeof code === 'string' ? code : 'unknown';
}
