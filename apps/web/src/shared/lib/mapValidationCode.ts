/**
 * Single source of truth для UA-рядків Zod-валідації.
 *
 * Zod-схеми з `@finly/types` встановлюють `message`-поля у форматі
 * SCREAMING_SNAKE машинних кодів (`INVALID_IBAN`, `INVALID_NAME_CHAR_LENGTH`,
 * `OWNERLESS_BUSINESS_REQUIRES_MANAGER` тощо). Цей мапер перекладає такий
 * код у user-facing UA-рядок з тоном, описаним у
 * `docs/conventions/tone.md` (classic-polite, "ви", без emojis, без ).
 *
 * **Чому окремо від `mapApiCode`**: `mapApiCode` мапить серверні
 * RESPONSE-CODE-и (rate limit, business_not_found тощо) — це інший
 * іменовий простір. Поєднання їх в один словник зробило б lookup
 * двозначним.
 *
 * Якщо код невідомий — повертається generic fallback. Це гарантує, що
 * користувач ніколи не побачить машинний код наживо, навіть якщо нова
 * Zod-помилка випадково додається без оновлення словника.
 */

const VALIDATION_MESSAGES: Record<string, string> = {
    // --- Базові поля користувача ---
    INVALID_EMAIL: 'Введіть коректну електронну адресу',
    INVALID_PASSWORD_TOO_SHORT: 'Пароль повинен містити щонайменше 8 символів',
    INVALID_CURRENT_PASSWORD_REQUIRED: 'Введіть поточний пароль',

    // --- Universal name (rare; nameSchema без префіксу) ---
    INVALID_NAME_TOO_SHORT: 'Назва має містити щонайменше 2 символи',
    INVALID_NAME_TOO_LONG: 'Назва не може бути довшою за 100 символів',
    INVALID_NAME_FORMAT:
        'Назва може містити лише літери, пробіли, дефіси та апострофи',

    // --- Ім'я / прізвище (firstNameSchema, lastNameSchema) ---
    INVALID_FIRST_NAME_TOO_SHORT: "Ім'я повинне містити щонайменше 2 символи",
    INVALID_FIRST_NAME_TOO_LONG: "Ім'я не може бути довшим за 50 символів",
    INVALID_FIRST_NAME_FORMAT:
        "Ім'я може містити лише літери, пробіли, дефіси та апострофи",
    INVALID_LAST_NAME_REQUIRED: 'Введіть прізвище',
    INVALID_LAST_NAME_TOO_LONG: 'Прізвище не може бути довшим за 50 символів',
    INVALID_LAST_NAME_FORMAT:
        'Прізвище може містити лише літери, пробіли, дефіси та апострофи',

    // --- Реквізити (IBAN, ІПН / ЄДРПОУ) ---
    // Два коди (format / checksum), бо причини різні. Format: користувач не
    // довів номер до 29 символів UA+цифри. Checksum: формат правильний, але
    // контрольна сума MOD-97 не зійшлася (десь описка в цифрі). Для checksum
    // НЕ можна писати «має бути 29 символів», бо людина це вже виконала.
    INVALID_IBAN_FORMAT:
        'Здається, номер IBAN неповний або введений з помилкою. Перевірте його',
    INVALID_IBAN_CHECKSUM:
        'Номер IBAN недійсний. Звірте кожну цифру з реквізитами: найчастіше це описка в одній цифрі',
    // Код покриває і невірну довжину, і провалену контрольну цифру (десята
    // цифра РНОКПП — контрольна за алгоритмом ДПС). Копія не каже «рівно 10
    // цифр»: на введених 10 цифрах з одруком це виглядало б як зламана
    // валідація.
    INVALID_TAX_ID: 'У РНОКПП є помилка. Перевірте всі 10 цифр',
    INVALID_TAX_ID_TOO_LONG: 'Забагато цифр: РНОКПП містить рівно 10',
    INVALID_LEGAL_TAX_ID_TOO_LONG: 'Забагато цифр: ЄДРПОУ містить рівно 8',
    // Sprint 7 §7.1 — структурна перевірка ЄДРПОУ для tov / organization.
    INVALID_LEGAL_TAX_ID: 'Перевірте ЄДРПОУ: рівно 8 цифр',

    // --- Назва бізнесу / інвойсу ---
    INVALID_NAME_REQUIRED: 'Введіть назву',
    INVALID_NAME_CHAR_LENGTH: 'Назва занадто довга. Максимум 140 символів',
    INVALID_NAME_BYTE_LENGTH:
        'Назва занадто довга для платіжного QR-коду. Скоротіть її',
    // Sprint 8 fix — entity-Zod NBU-charset refine. Окреме повідомлення
    // (не reuse BYTE_LENGTH-копії), бо UX-рекомендація різна: тут користувач
    // не повинен скорочувати назву, а використати лише дозволені символи
    // (Win1251-таблиця НБУ, без графічних значків і нестандартної typography).
    // Single-locale (uk) — без англомовних термінів у public copy
    // (`docs/conventions/tone.md`).
    INVALID_NAME_CHARSET:
        'Назва містить символи, які не підтримує платіжний QR-код. Використовуйте лише букви, цифри та звичайну пунктуацію',

    // --- Призначення платежу ---
    INVALID_PURPOSE_REQUIRED: 'Введіть призначення платежу',
    INVALID_PURPOSE_CHAR_LENGTH:
        'Призначення занадто довге. Максимум 420 символів',
    INVALID_PURPOSE_BYTE_LENGTH:
        'Призначення занадто довге для платіжного QR-коду. Скоротіть його',
    // Sprint 8 fix — symmetric з INVALID_NAME_CHARSET для purpose-поля.
    INVALID_PURPOSE_CHARSET:
        'Призначення містить символи, які не підтримує платіжний QR-код. Використовуйте лише букви, цифри та звичайну пунктуацію',
    // Sprint 29 — маркери підстановки (`{taxId}` тощо) працюють лише на
    // сторінках, які веде адмін. У звичайного отримувача такий текст пішов би
    // у QR буквально.
    PURPOSE_MARKERS_NOT_ALLOWED:
        'Приберіть підстановки у фігурних дужках: у призначення потрапить саме той текст, який ви написали',

    // --- Сума інвойсу ---
    INVALID_AMOUNT_OVERFLOW: 'Сума занадто велика. Максимум 999 999 999,99 грн',
    AMOUNT_LOCKED_REQUIRES_AMOUNT:
        'Заблокувати редагування суми можна лише при заданій сумі',
    INVALID_AMOUNT_FORMAT: 'Введіть число (наприклад, 1500 або 1500,50)',
    INVALID_AMOUNT_PRECISION: 'Не більше двох знаків після коми',
    INVALID_AMOUNT_NEGATIVE: 'Сума не може бути від’ємною',

    // --- Slug бізнесу / інвойсу ---
    INVALID_SLUG_TOO_SHORT: 'Посилання занадто коротке',
    INVALID_SLUG_TOO_LONG: 'Посилання занадто довге',
    INVALID_SLUG_FORMAT:
        'Дозволені лише латинські літери, цифри та дефіси (без пробілів, кирилиці й символів)',

    // --- Людська частина invoice-slug-у ---
    INVALID_HUMAN_SLUG_PART_LENGTH:
        'Назва рахунку має бути від 1 до 60 символів',
    INVALID_HUMAN_SLUG_PART_FORMAT:
        'Лише малі латинські літери, цифри та дефіси (без пробілів)',

    // --- Термін дії інвойсу ---
    VALID_UNTIL_DATE_REQUIRED: 'Оберіть дату',

    // --- Бізнес-правила ---
    INVALID_VAT_FOR_TAXATION_SYSTEM:
        'Платник ПДВ можливий лише на спрощеній-3 або загальній системі',
    ACCEPTED_BANKS_REQUIRED: 'Оберіть хоча б один банк',
    OWNERLESS_BUSINESS_REQUIRES_MANAGER: 'Додайте хоча б одного керівника',
    // Sprint 7 §SP-3 — iff-інваріант (taxation iff requiresTaxation(type)).
    // Звичайний user через wizard-форму цього не побачить (write-DTO
    // discriminated union відсікає таку комбінацію раніше); код призначений
    // для curl-ів та safety-net-у на read-side.
    TAXATION_FIELDS_MISMATCH_TYPE:
        'Поля оподаткування не відповідають типу платника',
    // Sprint 7 §SP-4 — taxId-формат за `type`. Inline-помилка під полем
    // "Код одержувача"; видається з backend-у при mismatch (Crок 6).
    TAX_ID_FORMAT_MISMATCH_TYPE:
        'Код одержувача не відповідає формату для цього типу платника',
    // Юр-обмеження ПКУ: для ТОВ доступні лише спрощена-3 і загальна; групи 1
    // і 2 єдиного податку — виключно для ФОП. Inline-помилка під полем
    // "Система оподаткування" у wizard-step і edit-section.
    TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE:
        'Ця система оподаткування недоступна для обраного типу отримувача',

    // --- Single-form /business/new (BusinessCreateForm) cross-field ---
    // Коди емітяться superRefine-ом форми, не entity-Zod-схемами з
    // `@finly/types`. Видимі лише у момент створення бізнесу, коли
    // обраний тип fop|tov але користувач ще не торкнув taxation-блок.
    INVALID_TYPE_REQUIRED: 'Оберіть тип отримувача',
    TAXATION_REQUIRED_FOR_TYPE: 'Оберіть систему оподаткування',
    INVALID_VAT_REQUIRED: 'Оберіть варіант ПДВ',
};

const FALLBACK = 'Перевірте правильність значення';

/**
 * Перекласти Zod-код у UA-рядок. Якщо код невідомий — повертається
 * generic fallback ("Перевірте правильність значення"), щоб користувач
 * ніколи не побачив `INVALID_FOO_BAR` у UI.
 *
 * Відсутній/порожній код → `undefined` (RHF/UI рендерять "немає помилки").
 */
export function mapValidationCode(
    code: string | undefined
): string | undefined {
    if (!code) return undefined;
    return VALIDATION_MESSAGES[code] ?? FALLBACK;
}
