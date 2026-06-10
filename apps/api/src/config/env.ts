// ============================================================
// FAIL FAST POLICY:
// Every env var is required. No fallbacks. No defaults in code.
// If a variable is missing, crash immediately.
// All values live in .env (dev) or environment config (prod).
// ============================================================

import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from monorepo root before reading process.env.
// Use __dirname (relative to this file) instead of process.cwd() which varies by runner.
// In Docker, env vars are set via `environment:` — dotenv silently skips if file not found.
config({ path: resolve(__dirname, '../../../../.env') });

const getEnvVar = (name: string): string => {
    const value = process.env[name];
    if (!value) {
        throw new Error(`❌ Environment variable "${name}" is not defined`);
    }
    return value;
};

const subscriptionEnabled =
    getEnvVar('PAYMENTS_SUBSCRIPTION_ENABLED') === 'true';
const oneOffEnabled = getEnvVar('PAYMENTS_ONE_OFF_ENABLED') === 'true';
// Демо-інструменти білінгу (POST /payments/reset: повне видалення підписки,
// історії платежів і webhook-маркерів користувача). На проді з живими грошима
// МУСИТЬ бути false — інакше користувач одним кліком знищує фінансову історію
// і знімає idempotency-захист обробки вебхуків. Web-аналог:
// NEXT_PUBLIC_BILLING_DEMO_MODE (ховає секцію «Скинути білінг»).
const billingDemoMode = getEnvVar('BILLING_DEMO_MODE') === 'true';

export const ENV = {
    NODE_ENV: getEnvVar('NODE_ENV'),
    PORT: getEnvVar('PORT'),
    /**
     * Кількість довірених reverse-proxy перед API (Express `trust proxy`).
     * 0 — API дивиться у світ напряму: X-Forwarded-For ігнорується,
     * `request.ip` = socket-адреса (спуфінг неможливий). N>0 — за N проксі:
     * `request.ip` береться з XFF з довірою до останніх N hop-ів. Критично для
     * per-IP rate-limit-ів (help-chat guard, throttler): хибний 0 за проксі
     * злив би всіх відвідувачів в один IP проксі, хибний N>0 без проксі
     * дозволив би клієнту підробляти IP заголовком.
     */
    TRUST_PROXY_HOPS: parseInt(getEnvVar('TRUST_PROXY_HOPS'), 10),
    /**
     * Cabinet origin (`finly.com.ua` prod, `localhost:3000` dev). Використовується
     * для CORS, OAuth callback, magic-link redirect, WayForPay return/service
     * URL, email-template посилань на кабінет — усі шляхи, що ведуть
     * авторизованого ФОП назад у його кабінет.
     */
    WEB_URL: getEnvVar('WEB_URL'),
    /**
     * Public payment-page origin (`pay.finly.com.ua` prod, `pay.finly.local:3000`
     * dev — налаштовується через `/etc/hosts`, див. Sprint 3 §3.9). Sprint 3
     * рішення A1: cabinet і public живуть на різних host-ах для cookie/auth
     * ізоляції. QR-картинка `/businesses/public/:slug/qr/business.png` кодує
     * URL клієнта (не ФОП-а) → це **public host**, не WEB_URL.
     */
    PAY_PUBLIC_URL: getEnvVar('PAY_PUBLIC_URL'),

    MONGODB_URI: getEnvVar('MONGODB_URI'),
    JWT_ACCESS_SECRET: getEnvVar('JWT_ACCESS_SECRET'),
    JWT_REFRESH_SECRET: getEnvVar('JWT_REFRESH_SECRET'),
    REDIS_URL: getEnvVar('REDIS_URL'),

    GOOGLE_CLIENT_ID: getEnvVar('GOOGLE_CLIENT_ID'),
    GOOGLE_CLIENT_SECRET: getEnvVar('GOOGLE_CLIENT_SECRET'),
    GOOGLE_CALLBACK_URL: getEnvVar('GOOGLE_CALLBACK_URL'),

    RESEND_API_KEY: getEnvVar('RESEND_API_KEY'),
    RESEND_FROM_EMAIL: getEnvVar('RESEND_FROM_EMAIL'),

    // WayForPay (Sprint 17) — merchant-реквізити білінгу. `merchantDomainName`
    // має збігатись з доменом, зареєстрованим у кабінеті WayForPay, інакше
    // підпис Purchase/CREATE_INVOICE відхиляється. Sandbox: test_merch_n1 /
    // flk3409refn54t54t*FNJRET.
    WAYFORPAY_MERCHANT_ACCOUNT: getEnvVar('WAYFORPAY_MERCHANT_ACCOUNT'),
    WAYFORPAY_MERCHANT_SECRET_KEY: getEnvVar('WAYFORPAY_MERCHANT_SECRET_KEY'),
    WAYFORPAY_MERCHANT_DOMAIN: getEnvVar('WAYFORPAY_MERCHANT_DOMAIN'),

    PAYMENTS_SUBSCRIPTION_ENABLED: subscriptionEnabled,
    PAYMENTS_ONE_OFF_ENABLED: oneOffEnabled,
    BILLING_DEMO_MODE: billingDemoMode,

    AUTH_PASSWORD_MIN_LENGTH: parseInt(
        getEnvVar('AUTH_PASSWORD_MIN_LENGTH'),
        10
    ),
    AUTH_LOCKOUT_THRESHOLDS: getEnvVar('AUTH_LOCKOUT_THRESHOLDS'),
    AUTH_LOGIN_ATTEMPTS_TTL_MIN: parseInt(
        getEnvVar('AUTH_LOGIN_ATTEMPTS_TTL_MIN'),
        10
    ),
    AUTH_MAGIC_LINK_TTL_MIN: parseInt(getEnvVar('AUTH_MAGIC_LINK_TTL_MIN'), 10),
    AUTH_MAGIC_LINK_RATE_LIMIT: parseInt(
        getEnvVar('AUTH_MAGIC_LINK_RATE_LIMIT'),
        10
    ),
    AUTH_MAGIC_LINK_RATE_WINDOW_MIN: parseInt(
        getEnvVar('AUTH_MAGIC_LINK_RATE_WINDOW_MIN'),
        10
    ),
    AUTH_MAGIC_LINK_DEDUP_SEC: parseInt(
        getEnvVar('AUTH_MAGIC_LINK_DEDUP_SEC'),
        10
    ),
    ACCOUNT_DELETION_GRACE_DAYS: parseInt(
        getEnvVar('ACCOUNT_DELETION_GRACE_DAYS'),
        10
    ),

    ORPHAN_REMINDER_FIRST_DAYS: parseInt(
        getEnvVar('ORPHAN_REMINDER_FIRST_DAYS'),
        10
    ),
    ORPHAN_REMINDER_FINAL_DAYS: parseInt(
        getEnvVar('ORPHAN_REMINDER_FINAL_DAYS'),
        10
    ),
    ORPHAN_CLEANUP_DELETION_DAYS: parseInt(
        getEnvVar('ORPHAN_CLEANUP_DELETION_DAYS'),
        10
    ),

    ANTHROPIC_API_KEY: getEnvVar('ANTHROPIC_API_KEY'),

    // Public help assistant (Sprint 16) — anon, no executions. Own short
    // max-tokens (concise answers), own per-IP 24h limit and a global daily
    // budget circuit-breaker.
    HELP_CHAT_MAX_TOKENS: parseInt(getEnvVar('HELP_CHAT_MAX_TOKENS'), 10),
    HELP_CHAT_IP_LIMIT: parseInt(getEnvVar('HELP_CHAT_IP_LIMIT'), 10),
    HELP_CHAT_DAILY_BUDGET: parseInt(getEnvVar('HELP_CHAT_DAILY_BUDGET'), 10),

    // Cloudflare R2 — media storage (presigned uploads, Google avatar re-upload).
    // R2_PUBLIC_URL hostname MUST match NEXT_PUBLIC_STORAGE_HOSTNAME on the web
    // side — otherwise next/image rejects uploaded photos at runtime.
    R2_ACCOUNT_ID: getEnvVar('R2_ACCOUNT_ID'),
    R2_ACCESS_KEY_ID: getEnvVar('R2_ACCESS_KEY_ID'),
    R2_SECRET_ACCESS_KEY: getEnvVar('R2_SECRET_ACCESS_KEY'),
    R2_BUCKET_NAME: getEnvVar('R2_BUCKET_NAME'),
    R2_PUBLIC_URL: getEnvVar('R2_PUBLIC_URL'),
};

// Validate payment toggles
if (!ENV.PAYMENTS_SUBSCRIPTION_ENABLED && !ENV.PAYMENTS_ONE_OFF_ENABLED) {
    throw new Error(
        '❌ At least one payment type must be enabled. ' +
            'Set PAYMENTS_SUBSCRIPTION_ENABLED or PAYMENTS_ONE_OFF_ENABLED to "true".'
    );
}

// Sprint 10 §10.1 — dedup-overwrite-flow (sendMagicLink SP-8) припускає, що
// magic-record-у живий поки існує dedup-key. Інваріант: TTL magic-record-у
// (хвилини → секунди) ≥ TTL dedup-key-у (секунди). Якщо інверсія — dedup-key
// переживе magic-record-у, redis.get(`magic:${existingToken}`) поверне null,
// dedup-overwrite-flow упаде у fallthrough на normal-flow (новий token + лист)
// замість silent-overwrite — anti-spam invariant порушено.
if (ENV.AUTH_MAGIC_LINK_TTL_MIN * 60 < ENV.AUTH_MAGIC_LINK_DEDUP_SEC) {
    throw new Error(
        `❌ AUTH_MAGIC_LINK_DEDUP_SEC (${ENV.AUTH_MAGIC_LINK_DEDUP_SEC}s) ` +
            `must not exceed AUTH_MAGIC_LINK_TTL_MIN converted to seconds ` +
            `(${ENV.AUTH_MAGIC_LINK_TTL_MIN}min = ${ENV.AUTH_MAGIC_LINK_TTL_MIN * 60}s). ` +
            'Otherwise dedup-key outlives magic-record and overwrite-flow breaks.'
    );
}

// Парсинг AUTH_LOCKOUT_THRESHOLDS="5:1,10:5,20:15" → [{ attempts: 5, blockMin: 1 }, ...]
export function parseLockoutThresholds(
    raw: string
): Array<{ attempts: number; blockMin: number }> {
    return raw.split(',').map((entry) => {
        const [attempts, blockMin] = entry.split(':').map(Number);
        return { attempts, blockMin };
    });
}

// Sprint 12 §12.1a — cross-field invariant для orphan-cleanup pipeline.
// Stage-thresholds мусять монотонно зростати: first < final < deletion. Інакше
// 3-stage email-pipeline колапсує в один день (наприклад, first=final=deletion=2
// → один cron-run fires і reminder, і final-warning, і cascade-delete у race),
// порушуючи compliance-invariant "user попереджений 2 рази перед видаленням".
// first ≥ 1 — фіксує мінімальний grace-period між створенням Business і першим
// reminder-листом (нульовий day-0 fire ламає UX — лист приходить раніше за
// перший вход у кабінет після magic-link-claim).
export function validateOrphanCleanupSchedule(
    firstDays: number,
    finalDays: number,
    deletionDays: number
): void {
    if (!Number.isInteger(firstDays) || firstDays < 1) {
        throw new Error(
            `❌ ORPHAN_REMINDER_FIRST_DAYS must be an integer ≥ 1 (got ${firstDays}).`
        );
    }
    if (!Number.isInteger(finalDays) || !Number.isInteger(deletionDays)) {
        throw new Error(
            `❌ ORPHAN_REMINDER_FINAL_DAYS and ORPHAN_CLEANUP_DELETION_DAYS must be integers ` +
                `(got ${finalDays}, ${deletionDays}).`
        );
    }
    if (!(firstDays < finalDays && finalDays < deletionDays)) {
        throw new Error(
            `❌ Orphan-cleanup schedule must satisfy ` +
                `ORPHAN_REMINDER_FIRST_DAYS < ORPHAN_REMINDER_FINAL_DAYS < ORPHAN_CLEANUP_DELETION_DAYS ` +
                `(got ${firstDays} < ${finalDays} < ${deletionDays}). ` +
                'Otherwise email-pipeline stages overlap and "user warned twice before deletion" invariant breaks.'
        );
    }
}

validateOrphanCleanupSchedule(
    ENV.ORPHAN_REMINDER_FIRST_DAYS,
    ENV.ORPHAN_REMINDER_FINAL_DAYS,
    ENV.ORPHAN_CLEANUP_DELETION_DAYS
);
