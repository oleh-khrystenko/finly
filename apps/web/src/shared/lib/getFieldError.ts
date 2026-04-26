import type { FieldError } from 'react-hook-form';

type ErrorMessageMap = {
    required?: string;
    too_small?: string;
    too_big?: string;
    invalid_string?: string;
    invalid_format?: string;
};

/**
 * Maps a React Hook Form / Zod field error to the appropriate i18n message.
 *
 * When Zod's `too_small` covers both "required" (empty) and "min length" cases,
 * pass the current field value — the helper will use `required` for empty values
 * and `too_small` for non-empty values that are still below minimum.
 */
export function getFieldError(
    error: FieldError | undefined,
    messages: ErrorMessageMap,
    value?: string,
): string | undefined {
    if (!error) return undefined;

    if (error.type === 'too_big' && messages.too_big) return messages.too_big;

    if (error.type === 'invalid_string' && messages.invalid_string)
        return messages.invalid_string;
    if (error.type === 'invalid_format' && messages.invalid_format)
        return messages.invalid_format;

    if (error.type === 'too_small') {
        if (messages.required && !value?.trim()) return messages.required;
        if (messages.too_small) return messages.too_small;
        return messages.required;
    }

    return messages.required;
}
