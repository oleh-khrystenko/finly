export { composeClasses } from './utils';
export {
    OUTLINED_FIELD_STYLES,
    FIELD_LABEL_STYLES,
    type FieldLabelSize,
} from './outlinedFieldStyles';
// `./redirect` свідомо НЕ реекспортується: він читає fail-fast конфігурацію
// середовища, а цей barrel тягне кожен UI-примітив. Імпорт — прямим шляхом
// `@/shared/lib/redirect` (обґрунтування — у шапці самого модуля).
export { getTimezone } from './timezone';
export { mapValidationCode } from './mapValidationCode';
export { getZodFieldError } from './getZodFieldError';
export { focusFirstInvalidField } from './focusFirstInvalidField';
export { INTL_LOCALE, formatLocalDate, pluralizeUa } from './intl';
export { authEvents, type AuthEvent } from './authEvents';
export { kyivEndOfDayInstant, formatKyivDate, kyivYearMonth } from './kyivTz';
export { uaDateToIso, isoToUaDate } from './uaDate';
export {
    parseUaMoney,
    formatKopecksForInput,
    type MoneyParseError,
    type MoneyParseResult,
} from './money';
export { useAutoCancelOnRouteChange } from './useAutoCancelOnRouteChange';
export { useHasHydrated } from './useHasHydrated';
export { detectClientPlatform, type ClientPlatform } from './clientPlatform';
export { qrBrandVersion } from './qrBrandVersion';
