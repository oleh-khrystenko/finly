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

    // --- payments error ---
    ALREADY_SUBSCRIBED: 'ALREADY_SUBSCRIBED',
    NO_BILLING_ACCOUNT: 'NO_BILLING_ACCOUNT',
    PAYMENT_TYPE_DISABLED: 'PAYMENT_TYPE_DISABLED',
    NO_ACTIVE_SUBSCRIPTION: 'NO_ACTIVE_SUBSCRIPTION',
    INVALID_PLAN: 'INVALID_PLAN',
    /**
     * Sprint 22 — дія «оплатити зараз» (resume) застосовна лише до підписки у
     * стані прострочки (PAST_DUE). Викликана на активній чи відсутній підписці —
     * цей код. Recovery: дія недоступна, поки списання не відхилено.
     */
    SUBSCRIPTION_NOT_PAST_DUE: 'SUBSCRIPTION_NOT_PAST_DUE',
    /**
     * Sprint 22 — звірка списання за токеном дала суперечливий/нерозв'язний
     * результат (гроші могли рухатись, але стан звести не вдалося). Підписка
     * позначена на ручний розбір; користувачу нейтральна помилка.
     */
    BILLING_NEEDS_MANUAL_REVIEW: 'BILLING_NEEDS_MANUAL_REVIEW',
    /**
     * Sprint 17/22 — конкурентна білінг-мутація. Усі write-операції над підпискою
     * (checkout, resume, cancel) і billing-clock-списання серіалізовані per-user
     * Redis-локом: списання monobank за токеном неідемпотентне, тож два паралельні
     * запити (дві вкладки) чи гонка з планувальником інакше задвоїли б списання за
     * період. Lock зайнятий → цей код. Recovery: дочекатись і повторити.
     */
    BILLING_OPERATION_IN_PROGRESS: 'BILLING_OPERATION_IN_PROGRESS',

    // --- onboarding error ---
    ONBOARDING_INCOMPLETE: 'ONBOARDING_INCOMPLETE',

    // --- ai error ---
    AI_RATE_LIMIT_EXCEEDED: 'AI_RATE_LIMIT_EXCEEDED',
    AI_MESSAGE_TOO_LONG: 'AI_MESSAGE_TOO_LONG',
    AI_HELP_BUDGET_EXHAUSTED: 'AI_HELP_BUDGET_EXHAUSTED',

    // --- storage success ---
    AVATAR_UPDATED: 'AVATAR_UPDATED',
    AVATAR_DELETED: 'AVATAR_DELETED',

    // --- storage error ---
    AVATAR_UPLOAD_FAILED: 'AVATAR_UPLOAD_FAILED',
    AVATAR_FILE_KEY_INVALID: 'AVATAR_FILE_KEY_INVALID',
    AVATAR_UPLOAD_NOT_FOUND: 'AVATAR_UPLOAD_NOT_FOUND',
    AVATAR_UPLOAD_INVALID: 'AVATAR_UPLOAD_INVALID',

    // --- brand logo success (Sprint 21) ---
    /** Бренд активний (доступ ≥ brand): логотип рендериться публічно одразу. */
    BRAND_UPDATED: 'BRAND_UPDATED',
    /** Бренд знятий: active + pending очищені, публічно повертається Finly. */
    BRAND_DELETED: 'BRAND_DELETED',

    // --- brand logo error (Sprint 21) ---
    /** File key не відповідає формату або namespace-у бізнесу. */
    BRAND_LOGO_FILE_KEY_INVALID: 'BRAND_LOGO_FILE_KEY_INVALID',
    /** Presigned-завантаження не знайдено у R2 на commit (TTL минув / не вантажилось). */
    BRAND_LOGO_UPLOAD_NOT_FOUND: 'BRAND_LOGO_UPLOAD_NOT_FOUND',
    /** Невірний тип або завелика вага завантаженого файлу (HeadObject-перевірка). */
    BRAND_LOGO_INVALID: 'BRAND_LOGO_INVALID',
    /**
     * Вертикальне зображення (height > width). Приймаємо лише квадрат і
     * горизонтальний прямокутник — вертикальне не вписується у плашку/смугу.
     */
    BRAND_LOGO_ASPECT_INVALID: 'BRAND_LOGO_ASPECT_INVALID',
    /**
     * Надто витягнутий горизонтальний логотип (width / height > ліміт): не
     * вписується у верхню смугу НБУ-QR разом із підписом — текст вилазить за
     * межі. Відхиляємо з ясним повідомленням замість зламаної бренд-марки.
     */
    BRAND_LOGO_TOO_WIDE: 'BRAND_LOGO_TOO_WIDE',
    /** Майже білий/світлий логотип: зникне на білій плашці. Поріг емпіричний. */
    BRAND_LOGO_TOO_LIGHT: 'BRAND_LOGO_TOO_LIGHT',
    /** Збій сторонніх ops (download / bake / upload) — нейтральний 5xx-код. */
    BRAND_LOGO_UPLOAD_FAILED: 'BRAND_LOGO_UPLOAD_FAILED',

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
     * `taxId` неправильного формату для document-resident `type` (наприклад,
     * 8-digit ЄДРПОУ при type=fop, або 10-digit РНОКПП при type=tov). Sprint 9
     * §SP-1 path-update: `taxId` тепер top-level поле Business (раніше
     * `requisites.taxId`); semantics коду незмінні.
     *
     * Окремий код від `INVALID_TAX_ID` / `INVALID_LEGAL_TAX_ID` — ці два
     * описують **структурну** помилку (regex/checksum), цей — **type-binding**
     * (формат сам валідний, але не для цього `type`). UI підказує "ваш бізнес
     * — ФОП, потрібен 10-цифровий РНОКПП", не "введіть валідний код".
     */
    TAX_ID_FORMAT_MISMATCH_TYPE: 'TAX_ID_FORMAT_MISMATCH_TYPE',
    /**
     * Юр-обмеження ПКУ розд. XIV гл. 1: групи 1 і 2 єдиного податку доступні
     * виключно ФОП. ТОВ (юр-особа) може бути на групі 3 (спрощена-3) або на
     * загальній системі. Кидається з write-DTO refine (`createTovVariant`)
     * для cabinet-create та з service-layer `BusinessesService.update` для
     * PATCH, де DTO не несе `type` (поле immutable post-creation, §SP-8).
     *
     * Окремий код від `TAXATION_NOT_APPLICABLE_FOR_TYPE` (forward-direction
     * "поле недоступне") і `INVALID_VAT_FOR_TAXATION_SYSTEM` (VAT-coupling),
     * бо UX-recovery різний: тут користувач має обрати іншу систему зі
     * скороченого списку, не прибрати поле і не змінити VAT.
     */
    TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE: 'TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE',
    /**
     * Sprint 14 — vanity-slug edit. PATCH `slug` потрапив у reserved-список
     * (`qr`, `api`, `host-pay`, …) — slug не може ні створюватись, ні
     * редагуватись на ці значення (конфлікт з route-namespace-ами апки).
     */
    SLUG_RESERVED: 'SLUG_RESERVED',
    /**
     * Sprint 14 — vanity-slug edit. PATCH `slug` зайнятий іншим бізнесом —
     * або в `Business.slugLower` (поточний slug), або в `BusinessSlugHistory.
     * slugLower` (rename-history, anti-squatting window). Recovery-path для UI:
     * обрати інше значення.
     */
    SLUG_TAKEN: 'SLUG_TAKEN',

    // --- access tier / limits (Sprint 19) ---
    /**
     * Sprint 19 — редагування vanity-slug (бізнес/рахунок/інвойс) і скидання
     * slug вимагають рівня доступу не нижче brand. На Free slug автозгенерований
     * і незмінний. Upsell на платний тариф.
     */
    SLUG_EDIT_REQUIRES_PLAN: 'SLUG_EDIT_REQUIRES_PLAN',
    /**
     * Sprint 21 — кастомний брендинг отримувача (логотип у QR + на pay-сторінках)
     * вимагає рівня доступу не нижче brand. Подвійний бар'єр: на Save (free →
     * лого зберігається у pending-слот, цей код несе пейвол-стан у УСПІШНІЙ
     * відповіді commit-у, дзеркало slug-upsell — не throw) і на публічному
     * рендері (нижче brand → Finly). Upsell на тариф «Бренд».
     */
    BRAND_REQUIRES_PLAN: 'BRAND_REQUIRES_PLAN',
    /**
     * Sprint 19 — доменний інваріант: власник може мати максимум один бізнес
     * типу «фізособа» і один «ФОП». Не апсел (платний тариф не зніме ліміт) —
     * радимо редагувати наявний.
     */
    BUSINESS_TYPE_LIMIT_REACHED: 'BUSINESS_TYPE_LIMIT_REACHED',
    /**
     * Sprint 19 — перевищено ліміт бізнесів поточного рівня: власні ТОВ/
     * організації (по 1 на none/brand) або клієнтські бізнеси (до 10 на
     * none/brand). Знімається підпискою «Бухгалтер». Upsell на bookkeeper.
     */
    BUSINESS_LIMIT_REQUIRES_PLAN: 'BUSINESS_LIMIT_REQUIRES_PLAN',
    /**
     * Sprint 19 — створення бізнесів одного користувача серіалізується per-user
     * Redis-локом (ліміт рахується count-ом, без локу конкурентний double-submit
     * обходив би його). Лок не звільнився за відведені ретраї — повторити пізніше.
     */
    BUSINESS_CREATE_IN_PROGRESS: 'BUSINESS_CREATE_IN_PROGRESS',
    /**
     * Sprint 20 — бронь slug серіалізується per-user Redis-локом (інваріант
     * «одна активна бронь на користувача»). Конкурентний self-reserve (та сама
     * сутність у двох вкладках) не звільнив лок за відведені ретраї — повторити.
     */
    SLUG_RESERVATION_IN_PROGRESS: 'SLUG_RESERVATION_IN_PROGRESS',

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
     * Sprint 4 §4.0 + SP-5 / Sprint 9 §SP-1 + §SP-3 — generic infra-misconfig:
     * Mongo транзакція вимагає replica-set (`session.withTransaction`).
     * Standalone mongod кидає `MongoServerError: Transaction numbers are only
     * allowed on a replica set...`. Service ловить → 500 з цим кодом.
     *
     * **Уніфікований код для 4 service-call-сайтів** (Sprint 9 review fix —
     * раніше `CASCADE_DELETE_REQUIRES_REPLICA_SET` reuse-ався у не-cascade
     * flow-ах, що давало user-у "Не вдалося видалити бізнес" на create-account):
     *  - `BusinessesService.delete` (cascade-delete business+accounts+invoices)
     *  - `AccountsService.create` (touch-business orphan-prevention)
     *  - `AccountsService.delete` (cascade Invoice.count+Account.delete)
     *  - `InvoicesService.create` (touch-account orphan-prevention)
     *
     * UA: нейтральне "Сервер тимчасово недоступний. Зверніться в підтримку" —
     * справжню причину (infra-misconfig) видно лише у server-логах.
     */
    TRANSACTION_REQUIRES_REPLICA_SET: 'TRANSACTION_REQUIRES_REPLICA_SET',

    // --- accounts error (Sprint 9 §SP-1..§SP-3) ---
    /** Account не знайдено в межах business-у. `AccountAccessGuard` / `AccountsService.getBySlug`. UA: "Рахунок не знайдено". */
    ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
    /** `AccountAccessGuard` ownership-check fail (account.businessId ≠ request.business._id). UA: "Доступ до рахунку заборонено". */
    ACCOUNT_ACCESS_DENIED: 'ACCOUNT_ACCESS_DENIED',
    /**
     * `AccountSlugGeneratorService` після MAX_ATTEMPTS retries (астрономічно
     * недосяжно при random 8-char A-Za-z0-9). Окремий код від Sprint 3
     * `SLUG_GENERATION_FAILED` (business-domain): error-mapping може дати
     * домен-специфічну рекомендацію. UA: "Не вдалося згенерувати рахунок. Спробуйте ще раз".
     */
    ACCOUNT_SLUG_GENERATION_FAILED: 'ACCOUNT_SLUG_GENERATION_FAILED',
    /**
     * Sprint 9 §SP-2 — anti-duplicate IBAN під одним бізнесом. compound-unique
     * `(businessId, iban)` на Mongo; AccountsService.create ловить 11000 і
     * мапить на цей код. Cross-business-duplicate (один IBAN на двох бізнесах
     * одного юзера) — дозволено, цей код не спрацьовує. UA: "Цей IBAN вже доданий до бізнесу".
     */
    ACCOUNT_IBAN_DUPLICATE: 'ACCOUNT_IBAN_DUPLICATE',
    /**
     * Sprint 9 §SP-2 safety-net — unknown 11000-патерн у AccountsService.create
     * (не slug-collision, не iban-duplicate). UA: "Не вдалося створити рахунок. Спробуйте ще раз".
     */
    ACCOUNT_CREATE_FAILED: 'ACCOUNT_CREATE_FAILED',

    // --- qr error (Sprint 2 §2.1 + Sprint 8 fix) ---
    /**
     * Sprint 8 fix — overall payload-size overflow після build NBU-payload.
     * Per-field валідація проходить, але сума полів перевищує норматив 507 B
     * (Додатки 3 §IV.11, 4 §IV.8) АБО Base64URL-форма перевищує 475 B
     * (таблиця 1 у Додатках 3 і 4).
     *
     * Це **emergent property** комбінації полів, не окреме поле — Zod на
     * write-DTO технічно не може валідувати без виклику builder-а. Тому
     * `AllExceptionsFilter` ловить `PayloadValidationError` з кодами
     * `PAYLOAD_OVERALL_SIZE_EXCEEDED` / `PAYLOAD_BASE64URL_SIZE_EXCEEDED` і
     * мапить на цей код як 400 BAD_REQUEST. До Sprint 8 цей шлях віддавав
     * 500 INTERNAL_ERROR на legitimate user-input (наприклад
     * `purpose='А'.repeat(420)` cyrillic — валідні 420 chars, але payload 840 B).
     *
     * UA: "Ваші дані не вміщуються в платіжний QR-код. Скоротіть назву або
     * призначення платежу" — actionable рекомендація.
     */
    PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',

    // --- users error ---
    /**
     * Sprint 11 — open-redirect protection. `UsersService.setPendingPostLoginTarget`
     * відхиляє target, що не пройшов `validateSameOriginPath`. Шлях також
     * блокує DTO-validation на `PATCH /users/me`, якщо frontend помилково
     * передав non-null value (anti-injection rule). User-actionable повідомлення
     * не потрібне: стемп робиться backend-only, цей код ніколи не доходить до
     * happy-path UI.
     */
    INVALID_REDIRECT_TARGET: 'INVALID_REDIRECT_TARGET',

    // --- errors ---
    UNAUTHORIZED: 'UNAUTHORIZED',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
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
    [RESPONSE_CODE.ALREADY_SUBSCRIBED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.NO_BILLING_ACCOUNT]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.PAYMENT_TYPE_DISABLED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.NO_ACTIVE_SUBSCRIPTION]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.INVALID_PLAN]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.SUBSCRIPTION_NOT_PAST_DUE]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.BILLING_NEEDS_MANUAL_REVIEW]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.BILLING_OPERATION_IN_PROGRESS]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.AI_RATE_LIMIT_EXCEEDED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.AI_MESSAGE_TOO_LONG]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.AI_HELP_BUDGET_EXHAUSTED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.AVATAR_UPDATED]: RESPONSE_TYPE.SUCCESS,
    [RESPONSE_CODE.AVATAR_DELETED]: RESPONSE_TYPE.SUCCESS,
    [RESPONSE_CODE.AVATAR_UPLOAD_FAILED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.AVATAR_FILE_KEY_INVALID]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.AVATAR_UPLOAD_NOT_FOUND]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.AVATAR_UPLOAD_INVALID]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.BRAND_UPDATED]: RESPONSE_TYPE.SUCCESS,
    [RESPONSE_CODE.BRAND_DELETED]: RESPONSE_TYPE.SUCCESS,
    [RESPONSE_CODE.BRAND_LOGO_FILE_KEY_INVALID]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.BRAND_LOGO_UPLOAD_NOT_FOUND]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.BRAND_LOGO_INVALID]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.BRAND_LOGO_ASPECT_INVALID]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.BRAND_LOGO_TOO_WIDE]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.BRAND_LOGO_TOO_LIGHT]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.BRAND_LOGO_UPLOAD_FAILED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.BUSINESS_NOT_FOUND]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.BUSINESS_ACCESS_DENIED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.SLUG_GENERATION_FAILED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.INVALID_VAT_FOR_TAXATION_SYSTEM]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.INVALID_LEGAL_TAX_ID]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.TAXATION_NOT_APPLICABLE_FOR_TYPE]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.TAXATION_REQUIRED_FOR_TYPE]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.TAX_ID_FORMAT_MISMATCH_TYPE]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.SLUG_RESERVED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.SLUG_TAKEN]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.SLUG_EDIT_REQUIRES_PLAN]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.BRAND_REQUIRES_PLAN]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.BUSINESS_TYPE_LIMIT_REACHED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.BUSINESS_LIMIT_REQUIRES_PLAN]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.BUSINESS_CREATE_IN_PROGRESS]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.SLUG_RESERVATION_IN_PROGRESS]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.INVOICE_NOT_FOUND]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.INVOICE_SLUG_GENERATION_FAILED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.INVOICE_EXPIRED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.INVOICE_VALID_UNTIL_IN_PAST]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.TRANSACTION_REQUIRES_REPLICA_SET]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.ACCOUNT_NOT_FOUND]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.ACCOUNT_ACCESS_DENIED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.ACCOUNT_SLUG_GENERATION_FAILED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.ACCOUNT_IBAN_DUPLICATE]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.ACCOUNT_CREATE_FAILED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.PAYLOAD_TOO_LARGE]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.ONBOARDING_INCOMPLETE]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.INVALID_REDIRECT_TARGET]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.UNAUTHORIZED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.VALIDATION_ERROR]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.NOT_FOUND]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.RATE_LIMIT_EXCEEDED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.EMAIL_SEND_FAILED]: RESPONSE_TYPE.ERROR,
    [RESPONSE_CODE.INTERNAL_ERROR]: RESPONSE_TYPE.ERROR,
};
