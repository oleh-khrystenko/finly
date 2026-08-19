import { AxiosError } from 'axios';

/** Машинний код помилки з конверта API (`{ error: { code } }`). */
export function apiErrorCode(err: unknown): string | undefined {
    return err instanceof AxiosError
        ? err.response?.data?.error?.code
        : undefined;
}

/**
 * Текст відмови для дій з акаунтом. Спільний для небезпечної зони і модалки
 * видалення: обидві б'ють ті самі ендпоінти, тож і пояснювати відмову мусять
 * однаково.
 *
 * Ліміт листів тут головний: разових посилань дозволено три на адресу за
 * п'ятнадцять хвилин, а пауза між натисканнями — хвилина, тож кнопка
 * «Надіслати повторно» впирається в межу вже на четвертому натисканні. Загальний
 * текст лишив би людину без підказки, що треба просто зачекати.
 */
export function accountActionErrorMessage(err: unknown): string {
    if (apiErrorCode(err) === 'RATE_LIMIT_EXCEEDED') {
        return 'Забагато запитів. Спробуйте через 15 хвилин';
    }
    return 'Не вдалося виконати операцію. Спробуйте пізніше';
}
