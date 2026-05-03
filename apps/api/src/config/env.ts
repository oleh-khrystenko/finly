// ============================================================
// FAIL FAST POLICY:
// Every env var is required. No fallbacks. No defaults in code.
// If a variable is missing, crash immediately.
// All values live in .env (dev) or environment config (prod).
// ============================================================

import { config } from 'dotenv';
import { resolve } from 'path';

import {
    ALLOWED_NBU_PAYLOAD_LINK_HOSTS_003,
    isAllowedNbuPayloadLinkHost003,
} from '@finly/types';

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

export const ENV = {
    NODE_ENV: getEnvVar('NODE_ENV'),
    PORT: getEnvVar('PORT'),
    WEB_URL: getEnvVar('WEB_URL'),

    MONGODB_URI: getEnvVar('MONGODB_URI'),
    JWT_ACCESS_SECRET: getEnvVar('JWT_ACCESS_SECRET'),
    JWT_REFRESH_SECRET: getEnvVar('JWT_REFRESH_SECRET'),
    REDIS_URL: getEnvVar('REDIS_URL'),

    GOOGLE_CLIENT_ID: getEnvVar('GOOGLE_CLIENT_ID'),
    GOOGLE_CLIENT_SECRET: getEnvVar('GOOGLE_CLIENT_SECRET'),
    GOOGLE_CALLBACK_URL: getEnvVar('GOOGLE_CALLBACK_URL'),

    RESEND_API_KEY: getEnvVar('RESEND_API_KEY'),
    RESEND_FROM_EMAIL: getEnvVar('RESEND_FROM_EMAIL'),

    STRIPE_SECRET_KEY: getEnvVar('STRIPE_SECRET_KEY'),
    STRIPE_WEBHOOK_SECRET: getEnvVar('STRIPE_WEBHOOK_SECRET'),

    PAYMENTS_SUBSCRIPTION_ENABLED: subscriptionEnabled,
    PAYMENTS_ONE_OFF_ENABLED: oneOffEnabled,

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

    ANTHROPIC_API_KEY: getEnvVar('ANTHROPIC_API_KEY'),
    AI_CHAT_MAX_TOKENS: parseInt(getEnvVar('AI_CHAT_MAX_TOKENS'), 10),
    AI_CHAT_IP_LIMIT: parseInt(getEnvVar('AI_CHAT_IP_LIMIT'), 10),

    // Cloudflare R2 — media storage (presigned uploads, Google avatar re-upload).
    // R2_PUBLIC_URL hostname MUST match NEXT_PUBLIC_STORAGE_HOSTNAME on the web
    // side — otherwise next/image rejects uploaded photos at runtime.
    R2_ACCOUNT_ID: getEnvVar('R2_ACCOUNT_ID'),
    R2_ACCESS_KEY_ID: getEnvVar('R2_ACCESS_KEY_ID'),
    R2_SECRET_ACCESS_KEY: getEnvVar('R2_SECRET_ACCESS_KEY'),
    R2_BUCKET_NAME: getEnvVar('R2_BUCKET_NAME'),
    R2_PUBLIC_URL: getEnvVar('R2_PUBLIC_URL'),

    // QR payload host для format 003. Норматив (постанова НБУ № 97 від
    // 19.08.2025, Додаток 4 §I таблиця 1) дозволяє два значення:
    //   - "qr.bank.gov.ua" — основний, рекомендований для 003 (default).
    //   - "bank.gov.ua/qr" — fallback, якщо QR-6 manual check покаже, що
    //     частина банк-додатків не оновила app-link конфіги під qr.bank.gov.ua.
    // "Персоніфікований" host (домен НПП) недоступний — Finly не НПП.
    // Format 002 host фіксований нормативом окремо ("bank.gov.ua/qr/", Додаток
    // 3 §I таблиця 1) і живе як константа у packages/types/src/qr/, не env.
    // Деталі: docs/product/qr-spec/README.md "Host у нормативі".
    NBU_PAYLOAD_LINK_HOST: getEnvVar('NBU_PAYLOAD_LINK_HOST'),
};

// Validate payment toggles
if (!ENV.PAYMENTS_SUBSCRIPTION_ENABLED && !ENV.PAYMENTS_ONE_OFF_ENABLED) {
    throw new Error(
        '❌ At least one payment type must be enabled. ' +
            'Set PAYMENTS_SUBSCRIPTION_ENABLED or PAYMENTS_ONE_OFF_ENABLED to "true".'
    );
}

// Validate NBU payload link host against the spec-allowed whitelist.
// See docs/product/qr-spec/README.md "Host у нормативі".
if (!isAllowedNbuPayloadLinkHost003(ENV.NBU_PAYLOAD_LINK_HOST)) {
    throw new Error(
        `❌ NBU_PAYLOAD_LINK_HOST must be one of: ${ALLOWED_NBU_PAYLOAD_LINK_HOSTS_003.join(', ')}. ` +
            `Got: "${ENV.NBU_PAYLOAD_LINK_HOST}". ` +
            `See docs/product/qr-spec/README.md "Host у нормативі".`
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
