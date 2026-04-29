import { RESPONSE_CODE_TYPE, RESPONSE_TYPE } from '@neatslip/types';

/**
 * Returns an i18n key for the given API response code.
 *
 * Priority:
 * 1. notifications.{module}.{code_lower}  (success codes, if module provided)
 * 2. errors.{module}.{code_lower}         (error codes, if module provided)
 * 3. errors.generic.{code_lower}          (fallback)
 * 4. errors.generic.unknown               (final fallback)
 */
export function getApiMessageKey(code: string, module?: string): string {
    const lower = code.toLowerCase();
    const type = RESPONSE_CODE_TYPE[code as keyof typeof RESPONSE_CODE_TYPE];

    if (type === RESPONSE_TYPE.SUCCESS && module) {
        return `notifications.${module}.${lower}`;
    }

    if (module) {
        return `errors.${module}.${lower}`;
    }

    return `errors.generic.${lower}`;
}
