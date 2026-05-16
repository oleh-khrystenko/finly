import type { FieldError } from 'react-hook-form';
import { mapValidationCode } from './mapValidationCode';

/**
 * Уніфікований resolver Zod-помилки RHF-поля у UA-рядок.
 *
 * Конвенція: Zod-схеми (`@finly/types`) кладуть SCREAMING_SNAKE-код у
 * `error.message`. Цей хелпер пропускає його через `mapValidationCode`.
 * Якщо помилки немає — повертає `undefined` (UiInput, UiTextarea
 * розцінюють це як "valid"-стан).
 *
 * **Не торкається server-side помилок** (наприклад `setError` з кодом
 * 'server' у DeleteAccountDialog/ChangePasswordForm) — caller вирішує,
 * що показати: ручний літерал чи прохід через мапер.
 */
export function getZodFieldError(
    error: FieldError | undefined
): string | undefined {
    return mapValidationCode(error?.message);
}
