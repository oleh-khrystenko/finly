import { RESPONSE_CODE_TYPE, RESPONSE_TYPE } from '@finly/types';

/**
 * Returns a localized Ukrainian message for the given API response code.
 *
 * Lookup priority:
 * 1. notifications.{module}.{code_lower}  (success codes, if module provided)
 * 2. errors.{module}.{code_lower}         (error codes, if module provided)
 * 3. errors.generic.{code_lower}          (fallback)
 * 4. errors.generic.unknown               (final fallback)
 *
 * Some messages support `{minutes}` placeholder for rate-limit responses.
 */

type MessageDict = Record<string, string>;

const NOTIFICATIONS: Record<string, MessageDict> = {
    auth: {
        magic_link_sent: 'Посилання надіслано на вашу пошту',
        logged_out: 'Ви вийшли з акаунту',
        account_deleted: 'Акаунт деактивовано',
        password_reset: 'Пароль успішно змінено',
    },
    users: {
        terms_accepted: 'Умови прийнято.',
        onboarding_required: 'Будь ласка, заповніть профіль для продовження',
    },
    storage: {
        avatar_updated: 'Фото оновлено',
        avatar_deleted: 'Фото видалено',
    },
};

const ERRORS: Record<string, MessageDict> = {
    auth: {
        unauthorized: 'Час сесії вичерпано. Увійдіть знову',
        invalid_magic_link: 'Посилання недійсне або прострочене',
    },
    payments: {
        already_subscribed: 'У вас вже є активна підписка.',
        subscription_required: 'Для доступу потрібна активна підписка.',
        no_billing_account: 'Платіжний акаунт не знайдено. Оформіть підписку.',
    },
    users: {
        insufficient_executions:
            'Недостатньо виконань для цієї операції. Придбайте більше або оновіть підписку.',
        executions_reservation_active:
            'Попередній запит ще обробляється. Зачекайте кілька секунд і спробуйте знову.',
    },
    generic: {
        validation_error: 'Перевірте введені дані',
        rate_limit_exceeded:
            'Забагато запитів. Спробуйте через {minutes} хвилин',
        email_send_failed: 'Не вдалося надіслати лист. Спробуйте пізніше',
        internal_error: 'Сталася помилка на сервері. Спробуйте пізніше',
        unknown: 'Сталася помилка. Спробуйте пізніше',
        // Sprint 4 §4.2 SP-5 / Sprint 9 §SP-1 — infra-misconfig fallback для
        // всіх Mongo-transaction-call-sites (business cascade-delete + invoice
        // create + account create + account delete). Нейтральний message: ні
        // delete-flow, ні create-flow — generic-server-issue, бо причина —
        // конфігурація replica-set, видима лише у server-логах.
        transaction_requires_replica_set:
            'Сервер тимчасово недоступний. Зверніться в підтримку',
    },
    ai: {
        ai_rate_limit_exceeded: 'Забагато AI-запитів. Спробуйте пізніше.',
        ai_provider_error: 'AI тимчасово недоступний. Спробуйте пізніше.',
        ai_message_too_long:
            'Повідомлення занадто довге для поточної розмови. Скоротіть його або очистіть історію чату.',
    },
    storage: {
        avatar_upload_failed: 'Не вдалося завантажити фото. Спробуйте пізніше',
        avatar_file_key_invalid:
            'Сесія завантаження закінчилась. Спробуйте ще раз',
        avatar_upload_not_found:
            'Не вдалося знайти завантажене фото. Спробуйте ще раз',
        avatar_upload_invalid:
            'Цей файл не може бути використаний як фото. Спробуйте інше зображення',
    },
    businesses: {
        business_not_found: 'Бізнес не знайдено',
        business_access_denied: 'У вас немає доступу до цього бізнесу',
        slug_generation_failed:
            'Не вдалося згенерувати посилання. Спробуйте ще раз',
        invalid_vat_for_taxation_system:
            'Платник ПДВ дозволений лише на спрощеній-3 або загальній системі',
        // Sprint 7 §7.1 — структурна помилка ЄДРПОУ (`type ∈ {tov, organization}`).
        // Окреме повідомлення від generic `INVALID_TAX_ID` (РНОКПП), щоб
        // user розумів специфіку поля свого типу платника.
        invalid_legal_tax_id: 'ЄДРПОУ має містити 8 цифр',
        // Sprint 7 §7.5 forward-direction — користувач передав taxation-поле
        // для individual / organization, де воно не застосовується. UX:
        // "приберіть поле з форми".
        taxation_not_applicable_for_type:
            'Поля оподаткування недоступні для цього типу платника',
        // Sprint 7 §7.5 backward-direction — користувач намагається очистити
        // обов'язкове taxation-поле на fop / tov через null. UX: "оберіть
        // систему оподаткування" (recovery-path відрізняється від forward-direction).
        taxation_required_for_type:
            'Оберіть систему оподаткування: вона обов’язкова для цього типу платника',
        // Sprint 7 §7.5 — type-binding на PATCH `requisites.taxId`. Структурно
        // валідний код, але невідповідного формату для типу бізнесу.
        tax_id_format_mismatch_type:
            'Код одержувача не відповідає формату для цього типу платника',
        // ПКУ розд. XIV гл. 1 — групи 1 і 2 єдиного податку доступні лише ФОП;
        // ТОВ може бути на спрощеній-3 або загальній. Backend кидає на write-DTO
        // refine (`createTovVariant`) і у service-layer для PATCH; frontend
        // повідомляє користувача коротким inline-text-ом без перерахування
        // дозволених систем (dropdown уже відфільтрований).
        taxation_system_not_allowed_for_type:
            'Ця система оподаткування недоступна для обраного типу бізнесу',
        // Sprint 14 — vanity-slug edit. Користувач намагається встановити slug,
        // що співпадає з зарезервованим route-namespace-ом (`qr`, `api`,
        // `host-pay`, …).
        slug_reserved:
            'Це посилання зарезервоване системою. Оберіть інше',
        // Sprint 14 — vanity-slug edit. Slug уже зайнятий іншим бізнесом
        // (поточний slug або в історії перейменувань 90-денного вікна).
        slug_taken: 'Це посилання вже зайняте. Оберіть інше',
        // Placeholder-free копія `default`-throttler 429 (60/min/IP на cabinet).
        // Generic `rate_limit_exceeded` має `{minutes}`-placeholder, а cabinet-
        // callsite-и не мають джерела TTL для interpolate-у → literal `{minutes}`
        // протік би у UI. Symmetric з `qr.rate_limit_exceeded` (LAND-7).
        rate_limit_exceeded:
            'Забагато запитів. Зачекайте хвилину і спробуйте ще раз',
    },
    // Sprint 9 §SP-1..§SP-3 — accounts UA-messages. ACCOUNT_HAS_INVOICES не тут:
    // backend pre-resolves повідомлення через pluralizeUa (accounts.service.ts
    // ConflictException.message) — frontend toast.error читає поле message
    // напряму, mapApiCode-намір не потрібен.
    accounts: {
        account_not_found: 'Рахунок не знайдено',
        account_access_denied: 'У вас немає доступу до цього рахунку',
        account_slug_generation_failed:
            'Не вдалося згенерувати рахунок. Спробуйте ще раз',
        account_iban_duplicate: 'Цей IBAN вже доданий до бізнесу',
        account_create_failed:
            'Не вдалося створити рахунок. Спробуйте ще раз',
        rate_limit_exceeded:
            'Забагато запитів. Зачекайте хвилину і спробуйте ще раз',
    },
    invoices: {
        // Sprint 9 disambiguation — слово "рахунок" відведено під Account
        // (банківський рахунок). Invoice-домен везде — "інвойс".
        invoice_not_found: 'Інвойс не знайдено',
        invoice_slug_generation_failed:
            'Не вдалося згенерувати посилання. Спробуйте ще раз',
        invoice_amount_locked_requires_amount:
            'Заблокувати редагування суми можна лише при заданій сумі',
        // Sprint 4 review fix — server-side 410 Gone на QR endpoints після
        // `validUntil < now`. JSON-view продовжує працювати з `nbuLinks: null`,
        // тож банер "Термін інвойсу минув" рендериться без переходу на цей
        // toast — код використовується тільки якщо клієнт прямо запитає
        // expired QR-image (e.g., cached link, scraping).
        invoice_expired: 'Термін інвойсу минув',
        invoice_valid_until_in_past: 'Термін дії не може бути у минулому',
        rate_limit_exceeded:
            'Забагато запитів. Зачекайте хвилину і спробуйте ще раз',
    },
    // Sprint 8 fix — overall payload-size overflow після build NBU-payload.
    // Поле reєструється для API-side error mapping (`getApiMessage(code,
    // 'qr')`); викликає, наприклад, anon `POST /api/qr/preview` form
    // submit-handler через `mapApiCode`. Frontend Sprint 8 §8.3 буде ловити
    // axios 400-response з цим кодом і показувати toast з actionable-
    // рекомендацією.
    qr: {
        payload_too_large:
            'Ваші дані не вміщуються в платіжний QR-код. Скоротіть назву або призначення платежу',
        // Sprint 8 §8.3 — anon QR-preview throttle 10/min/IP. Окрема копія
        // (не fallback на `errors.generic.rate_limit_exceeded`), бо generic
        // використовує `{minutes}`-placeholder, а frontend `QrLandingForm`
        // не має джерела значення TTL для interpolate-у — без vars literal
        // `{minutes}` залишився б у toast (regression LAND-7). Symmetric з
        // `ai.ai_rate_limit_exceeded` (теж placeholder-free, бо TTL відомий
        // контексту).
        rate_limit_exceeded:
            'Забагато запитів. Зачекайте хвилину і спробуйте ще раз',
    },
};

const UNKNOWN_FALLBACK = ERRORS.generic.unknown;

function interpolate(
    template: string,
    vars?: Record<string, string | number>
): string {
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, key) =>
        key in vars ? String(vars[key]) : match
    );
}

/**
 * Resolve API response code to a Ukrainian message.
 *
 * @param code  Response code from API (any case; will be lowercased for lookup).
 * @param module Optional module hint (e.g. 'auth', 'ai', 'users').
 * @param vars Optional template variables (e.g. `{ minutes: 15 }`).
 */
export function getApiMessage(
    code: string,
    module?: string,
    vars?: Record<string, string | number>
): string {
    const lower = code.toLowerCase();
    const type = RESPONSE_CODE_TYPE[code as keyof typeof RESPONSE_CODE_TYPE];

    if (type === RESPONSE_TYPE.SUCCESS && module) {
        const msg = NOTIFICATIONS[module]?.[lower];
        if (msg) return interpolate(msg, vars);
    }

    if (module) {
        const msg = ERRORS[module]?.[lower];
        if (msg) return interpolate(msg, vars);
    }

    const generic = ERRORS.generic[lower];
    if (generic) return interpolate(generic, vars);

    return UNKNOWN_FALLBACK;
}
