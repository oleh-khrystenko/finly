/**
 * Sprint 29 — переклад Zod-повідомлень (машинних кодів зі спільних контрактів)
 * у короткий inline-текст під полем адмінських форм.
 *
 * Живе окремо від форм, бо і отримувач, і його реквізити валідуються тими самими
 * base-схемами (`accountNameSchema` реюзає slug-коди бізнесу, обидві поверхні
 * ділять `INVALID_PURPOSE_*`), тож мапа мусить бути одна.
 */
export type FieldErrors = Partial<Record<string, string>>;

const MESSAGES: Record<string, string> = {
    INVALID_NAME_REQUIRED: 'Введіть назву',
    INVALID_NAME_CHAR_LENGTH: 'Назва задовга: максимум 140 символів',
    INVALID_NAME_BYTE_LENGTH: 'Назва задовга',
    INVALID_NAME_CHARSET: 'Назва містить недопустимі символи',
    INVALID_ACCOUNT_NAME_REQUIRED: 'Введіть назву',
    INVALID_ACCOUNT_NAME_CHAR_LENGTH: 'Назва задовга: максимум 60 символів',
    INVALID_ACCOUNT_NAME_BYTE_LENGTH: 'Назва задовга',
    INVALID_ACCOUNT_NAME_CHARSET: 'Назва містить недопустимі символи',
    INVALID_TAX_ID: 'Невірний РНОКПП',
    INVALID_LEGAL_TAX_ID: 'ЄДРПОУ має містити 8 цифр',
    INVALID_PURPOSE_REQUIRED: 'Введіть призначення',
    INVALID_PURPOSE_CHAR_LENGTH: 'Призначення задовге',
    INVALID_PURPOSE_BYTE_LENGTH: 'Призначення задовге',
    INVALID_PURPOSE_CHARSET: 'Призначення містить недопустимі символи',
    PURPOSE_MARKER_UNKNOWN: 'Невідомий маркер у призначенні',
    INVALID_SLUG_TOO_SHORT: 'Посилання закоротке: мінімум 3 символи',
    INVALID_SLUG_TOO_LONG: 'Посилання задовге',
    INVALID_SLUG_FORMAT: 'Лише латиниця, цифри і дефіс',
    INVALID_VAT_FOR_TAXATION_SYSTEM:
        'ПДВ доступний лише на спрощеній-3 або загальній системі',
    TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE:
        'Ця система оподаткування недоступна для обраного типу',
};

export function mapFieldMessage(code: string): string {
    return MESSAGES[code] ?? 'Перевірте поле';
}

/** Zod-issues → мапа `поле → текст помилки` для inline-рендеру у формі. */
export function collectFieldErrors(
    issues: readonly { path: PropertyKey[]; message: string }[]
): FieldErrors {
    const next: FieldErrors = {};
    for (const issue of issues) {
        const key = String(issue.path[0] ?? 'form');
        next[key] = mapFieldMessage(issue.message);
    }
    return next;
}
