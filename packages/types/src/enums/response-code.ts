import { RESPONSE_TYPE, type ResponseType } from './response-type';

export const RESPONSE_CODE = {
    // --- auth success ---
    MAGIC_LINK_SENT: 'MAGIC_LINK_SENT',
    LOGGED_OUT: 'LOGGED_OUT',
    PASSWORD_SET: 'PASSWORD_SET',
    PASSWORD_RESET: 'PASSWORD_RESET',
    ACCOUNT_DELETED: 'ACCOUNT_DELETED',
    ACCOUNT_RESTORED: 'ACCOUNT_RESTORED',

    // --- users success ---
    TERMS_ACCEPTED: 'TERMS_ACCEPTED',
    EXECUTIONS_SPENT: 'EXECUTIONS_SPENT',

    // --- payments error ---
    ALREADY_SUBSCRIBED: 'ALREADY_SUBSCRIBED',
    SUBSCRIPTION_REQUIRED: 'SUBSCRIPTION_REQUIRED',
    NO_BILLING_ACCOUNT: 'NO_BILLING_ACCOUNT',
    PAYMENT_TYPE_DISABLED: 'PAYMENT_TYPE_DISABLED',

    // --- onboarding error ---
    ONBOARDING_INCOMPLETE: 'ONBOARDING_INCOMPLETE',

    // --- ai error ---
    AI_RATE_LIMIT_EXCEEDED: 'AI_RATE_LIMIT_EXCEEDED',
    AI_MESSAGE_TOO_LONG: 'AI_MESSAGE_TOO_LONG',

    // --- executions error ---
    EXECUTIONS_RESERVATION_ACTIVE: 'EXECUTIONS_RESERVATION_ACTIVE',

    // --- storage success ---
    AVATAR_UPDATED: 'AVATAR_UPDATED',
    AVATAR_DELETED: 'AVATAR_DELETED',

    // --- storage error ---
    AVATAR_UPLOAD_FAILED: 'AVATAR_UPLOAD_FAILED',
    AVATAR_FILE_KEY_INVALID: 'AVATAR_FILE_KEY_INVALID',
    AVATAR_UPLOAD_NOT_FOUND: 'AVATAR_UPLOAD_NOT_FOUND',
    AVATAR_UPLOAD_INVALID: 'AVATAR_UPLOAD_INVALID',

    // --- businesses error (Sprint 3 §3.10) ---
    BUSINESS_NOT_FOUND: 'BUSINESS_NOT_FOUND',
    BUSINESS_ACCESS_DENIED: 'BUSINESS_ACCESS_DENIED',
    SLUG_GENERATION_FAILED: 'SLUG_GENERATION_FAILED',
    /**
     * Sprint 3 §3.2 cross-field VAT × taxationSystem check (рішення C1).
     * Service-layer кидає цей код, коли клієнт PATCH-ить тільки одне з пари
     * `(taxationSystem, isVatPayer)` так, що результуюча комбінація стає
     * невалідною (наприклад, isVatPayer=true з existing simplified-1).
     *
     * Sprint 3 рішення E6 (inline-edit per field у кабінеті) — frontend
     * передає лише змінене поле; cross-field validation у Zod write-DTO
     * skip-иться, коли пара не повна. Service читає БД, валідує комбо,
     * кидає цей машинний код. Frontend через mapApiCode → inline-помилка
     * під полем "Платник ПДВ".
     *
     * Recoverable client-side: ФОП обирає валідну пару і повторно save-ить.
     */
    INVALID_VAT_FOR_TAXATION_SYSTEM: 'INVALID_VAT_FOR_TAXATION_SYSTEM',
    /**
     * Sprint 7 §7.1 — структурна перевірка ЄДРПОУ (`^\d{8}$`) для типів
     * `tov` / `organization`. Окремий код від `INVALID_TAX_ID` (РНОКПП), щоб
     * `mapApiCode` міг видати специфічне повідомлення "ЄДРПОУ має містити
     * 8 цифр" замість загального "Неправильний податковий код".
     *
     * Розгалуження валідатора живе у Zod write-DTO (`CreateBusinessSchema`
     * discriminated union per `type`) і у `BusinessesService.update`
     * (читає document-resident `type` для PATCH без `type`-context).
     *
     * **MVP не валідує ДКСУ-checksum** (Sprint 7 §SP-2): naive-impl false-
     * negative-ить ~5-10% валідних реальних ЄДРПОУ; checksum — окремий
     * tech-backlog ticket.
     */
    INVALID_LEGAL_TAX_ID: 'INVALID_LEGAL_TAX_ID',
    /**
     * Sprint 7 §7.5 — service-layer cross-check на UPDATE: PATCH містить
     * `taxationSystem` чи `isVatPayer`, але document-resident `type` —
     * `individual` чи `organization`, де taxation-поля семантично не
     * застосовуються (не існує "ОСББ на спрощеній-3").
     *
     * **Виключно forward-direction garbage** ("поля недоступні для цього
     * типу"). Зворотний випадок (null-clear на fop/tov, де поля обов'язкові)
     * — окремий код `TAXATION_REQUIRED_FOR_TYPE`, бо UX-recovery різний:
     *  - тут: видалити поле з PATCH-payload-у;
     *  - там: передати non-null значення.
     *
     * Чому окремий код від `TAXATION_FIELDS_MISMATCH_TYPE` (read-side
     * entity-refine): user-action — PATCH; recoverable client-side. Generic
     * refine-error описує symmetric data-state-violation, інтерпретується для
     * UI як "бекенд-bug"; цей же код — UX-actionable.
     */
    TAXATION_NOT_APPLICABLE_FOR_TYPE: 'TAXATION_NOT_APPLICABLE_FOR_TYPE',
    /**
     * Sprint 7 §7.5 — backward-сторона того ж cross-check-у: PATCH намагається
     * очистити (`null`) `taxationSystem` чи `isVatPayer` на бізнесі типу
     * `fop` / `tov`, де таксейшн-поля обов'язкові. Семантично це "ви не
     * можете видалити обов'язкове поле", не "поле недоступне".
     *
     * Recovery-path для UI: передати non-null значення (підказка "оберіть
     * систему оподаткування"). Реальний flow зміни на null — створення нового
     * бізнесу типу `individual` / `organization`, бо `type` immutable
     * post-creation (§SP-8).
     */
    TAXATION_REQUIRED_FOR_TYPE: 'TAXATION_REQUIRED_FOR_TYPE',
    /**
     * Sprint 7 §7.5 — service-layer cross-check на UPDATE: PATCH містить
     * `requisites.taxId` неправильного формату для document-resident `type`
     * (наприклад, 8-digit ЄДРПОУ при type=fop, або 10-digit РНОКПП при
     * type=tov).
     *
     * Окремий код від `INVALID_TAX_ID` / `INVALID_LEGAL_TAX_ID` — ці два
     * описують **структурну** помилку (regex/checksum), цей — **type-binding**
     * (формат сам валідний, але не для цього `type`). UI підказує "ваш бізнес
     * — ФОП, потрібен 10-цифровий РНОКПП", не "введіть валідний код".
     */
    TAX_ID_FORMAT_MISMATCH_TYPE: 'TAX_ID_FORMAT_MISMATCH_TYPE',

    // --- invoices error (Sprint 4 §4.2 §4.8) ---
    /** Invoice не знайдено в межах business-у. `InvoiceAccessGuard` / `InvoicesService.getBySlug`. UA: "Рахунок не знайдено". */
    INVOICE_NOT_FOUND: 'INVOICE_NOT_FOUND',
    /** `InvoiceSlugGeneratorService` після MAX_ATTEMPTS retries (статистично недосяжно). UA: "Не вдалося згенерувати посилання. Спробуйте ще раз". */
    INVOICE_SLUG_GENERATION_FAILED: 'INVOICE_SLUG_GENERATION_FAILED',
    /** Coupled-rule на write-side: `amount=null + amountLocked=true`. Sprint 1 entity Zod дублює; service окремий код для UX-friendly inline error. UA: "Заблокувати редагування суми можна лише при заданій сумі". */
    INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT:
        'INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT',
    /**
     * Sprint 4 review fix — invoice expired (`validUntil < now`). Public QR
     * endpoints повертають 410 Gone з цим кодом. JSON-view продовжує працювати
     * (heading + "Прострочено"-banner), але `nbuLinks: null` — payment-vector
     * не віддається. UA: "Термін рахунку минув".
     */
    INVOICE_EXPIRED: 'INVOICE_EXPIRED',
    /**
     * Sprint 4 review fix — write-side service блокує `validUntil < now` на
     * create/update. Раніше комментарі схеми проголошували, що app-layer
     * service блокує цей інваріант, але enforcement не існував. Тепер code
     * приходить з 400 BadRequest на cabinet write. UA: "Термін дії не може
     * бути у минулому".
     */
    INVOICE_VALID_UNTIL_IN_PAST: 'INVOICE_VALID_UNTIL_IN_PAST',
    /**
     * Sprint 4 §4.0 + SP-5 — cascade-delete вимагає Mongo replica-set
     * (`session.withTransaction`). Standalone mongod кидає
     * `MongoServerError: Transaction numbers are only allowed on a replica set...`.
     * Service ловить → 500 з цим кодом, без жодного fallback на 2 sequential
     * deletes. Це failure-mode для misconfigured infra, не runtime-fallback.
     * UA: нейтральне "Не вдалося видалити бізнес. Зверніться в підтримку" —
     * справжню причину видно лише у server-логах.
     */
    CASCADE_DELETE_REQUIRES_REPLICA_SET: 'CASCADE_DELETE_REQUIRES_REPLICA_SET',

    // --- errors ---
    UNAUTHORIZED: 'UNAUTHORIZED',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
    INSUFFICIENT_EXECUTIONS: 'INSUFFICIENT_EXECUTIONS',
    EMAIL_SEND_FAILED: 'EMAIL_SEND_FAILED',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ResponseCode = (typeof RESPONSE_CODE)[keyof typeof RESPONSE_CODE];

/** Маппінг код → тип для фронту (колір нотифікації тощо) */
export const RESPONSE_CODE_TYPE: Record<ResponseCode, ResponseType> = {
    [RESPONSE_CODE.MAGIC_LINK_SENT]: RESPONSE_TYPE.SUCCESS,
    [RESPONSE_CODE.LOGGED_OUT]: RESPONSE_TYPE.SUCCESS,
    [RESPONSE_CODE.PASSWORD_SET]: RESPONSE_TYPE.SUCCESS,
    [RESPONSE_CODE.PASSWORD_RESET]: RESPONSE_TYPE.SUCCESS,
    [RESPONSE_CODE.TERMS_ACCEPTED]: RESPONSE_TYPE.SUCCESS,
    [RESPONSE_CODE.ACCOUNT_DELETED]: RESPONSE_TYPE.SUCCESS,
    [RESPONSE_CODE.ACCOUNT_RESTORED]: RESPONSE_TYPE.SUCCESS,
    [RESPONSE_CODE.EXECUTIONS_SPENT]: RESPONSE_TYPE.SUCCESS,
    [RESPONSE_CODE.ALREADY_SUBSCRIBED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.SUBSCRIPTION_REQUIRED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.NO_BILLING_ACCOUNT]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.PAYMENT_TYPE_DISABLED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.AI_RATE_LIMIT_EXCEEDED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.AI_MESSAGE_TOO_LONG]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.EXECUTIONS_RESERVATION_ACTIVE]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.AVATAR_UPDATED]: RESPONSE_TYPE.SUCCESS,
    [RESPONSE_CODE.AVATAR_DELETED]: RESPONSE_TYPE.SUCCESS,
    [RESPONSE_CODE.AVATAR_UPLOAD_FAILED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.AVATAR_FILE_KEY_INVALID]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.AVATAR_UPLOAD_NOT_FOUND]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.AVATAR_UPLOAD_INVALID]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.BUSINESS_NOT_FOUND]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.BUSINESS_ACCESS_DENIED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.SLUG_GENERATION_FAILED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.INVALID_VAT_FOR_TAXATION_SYSTEM]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.INVALID_LEGAL_TAX_ID]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.TAXATION_NOT_APPLICABLE_FOR_TYPE]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.TAXATION_REQUIRED_FOR_TYPE]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.TAX_ID_FORMAT_MISMATCH_TYPE]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.INVOICE_NOT_FOUND]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.INVOICE_SLUG_GENERATION_FAILED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.INVOICE_EXPIRED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.INVOICE_VALID_UNTIL_IN_PAST]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.CASCADE_DELETE_REQUIRES_REPLICA_SET]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.ONBOARDING_INCOMPLETE]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.UNAUTHORIZED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.VALIDATION_ERROR]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.NOT_FOUND]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.RATE_LIMIT_EXCEEDED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.INSUFFICIENT_EXECUTIONS]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.EMAIL_SEND_FAILED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.INTERNAL_ERROR]: RESPONSE_TYPE.ERROR,
};
