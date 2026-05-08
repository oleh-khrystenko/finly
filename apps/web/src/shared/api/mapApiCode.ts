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
        account_deleted: 'Акаунт видалено',
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
        no_billing_account:
            'Платіжний акаунт не знайдено. Оформіть підписку.',
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
    },
    ai: {
        ai_rate_limit_exceeded: 'Забагато AI-запитів. Спробуйте пізніше.',
        ai_provider_error: 'AI тимчасово недоступний. Спробуйте пізніше.',
        ai_message_too_long:
            'Повідомлення занадто довге для поточної розмови. Скоротіть його або очистіть історію чату.',
    },
    storage: {
        avatar_upload_failed:
            'Не вдалося завантажити фото. Спробуйте пізніше',
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
        // Sprint 4 §4.2 SP-5 — cascade-delete без replica-set. Нейтральне
        // user-facing повідомлення: справжню причину (infra-misconfig) видно
        // лише у server-логах, не leak-ається user-у.
        cascade_delete_requires_replica_set:
            'Не вдалося видалити бізнес. Зверніться в підтримку',
    },
    invoices: {
        invoice_not_found: 'Рахунок не знайдено',
        invoice_slug_generation_failed:
            'Не вдалося згенерувати посилання. Спробуйте ще раз',
        invoice_amount_locked_requires_amount:
            'Заблокувати редагування суми можна лише при заданій сумі',
        // Sprint 4 review fix — server-side 410 Gone на QR endpoints після
        // `validUntil < now`. JSON-view продовжує працювати з `nbuLinks: null`,
        // тож банер "Термін рахунку минув" рендериться без переходу на цей
        // toast — код використовується тільки якщо клієнт прямо запитає
        // expired QR-image (e.g., cached link, scraping).
        invoice_expired: 'Термін рахунку минув',
        invoice_valid_until_in_past:
            'Термін дії не може бути у минулому',
    },
};

const UNKNOWN_FALLBACK = ERRORS.generic.unknown;

function interpolate(
    template: string,
    vars?: Record<string, string | number>,
): string {
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, key) =>
        key in vars ? String(vars[key]) : match,
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
    vars?: Record<string, string | number>,
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
