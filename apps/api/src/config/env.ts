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

export const ENV = {
    NODE_ENV: getEnvVar('NODE_ENV'),
    PORT: getEnvVar('PORT'),
    /**
     * Cabinet origin (`finly.com.ua` prod, `localhost:3000` dev). Використовується
     * для CORS, OAuth callback, magic-link redirect, Stripe success/cancel URL,
     * email-template посилань на кабінет — усі шляхи, що ведуть авторизованого
     * ФОП назад у його кабінет.
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
};

// Validate payment toggles
if (!ENV.PAYMENTS_SUBSCRIPTION_ENABLED && !ENV.PAYMENTS_ONE_OFF_ENABLED) {
    throw new Error(
        '❌ At least one payment type must be enabled. ' +
            'Set PAYMENTS_SUBSCRIPTION_ENABLED or PAYMENTS_ONE_OFF_ENABLED to "true".'
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
