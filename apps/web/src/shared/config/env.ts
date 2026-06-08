// ============================================================
// FAIL FAST POLICY:
// Every env var is required. No fallbacks. No defaults in code.
// If a variable is missing, crash immediately.
//
// IMPORTANT: NEXT_PUBLIC_* vars MUST use direct process.env.VAR
// access (not dynamic process.env[name]) so Next.js can inline
// values into the client bundle at build time.
// ============================================================

function assertEnv(value: string | undefined, name: string): string {
    if (!value) {
        throw new Error(`❌ Environment variable "${name}" is not defined`);
    }
    return value;
}

export const ENV = {
    NEXT_PUBLIC_BASE_URL: assertEnv(
        process.env.NEXT_PUBLIC_BASE_URL,
        'NEXT_PUBLIC_BASE_URL'
    ),
    NEXT_PUBLIC_API_URL: assertEnv(
        process.env.NEXT_PUBLIC_API_URL,
        'NEXT_PUBLIC_API_URL'
    ),
    // Sprint 3 §3.9 — public payment-page origin (`pay.finly.com.ua` prod
    // / `pay.finly.local:3000` dev). Cabinet UI використовує цей host для
    // copy-link і `<a href={...}>` "Відкрити в новій вкладці"; QR-картинка
    // на public-сторінку кодує саме цей URL (api side, ENV.PAY_PUBLIC_URL).
    NEXT_PUBLIC_PAY_PUBLIC_URL: assertEnv(
        process.env.NEXT_PUBLIC_PAY_PUBLIC_URL,
        'NEXT_PUBLIC_PAY_PUBLIC_URL'
    ),
    // Hostname of the R2 public CDN. Used by next/image `remotePatterns`.
    // MUST equal the hostname of `R2_PUBLIC_URL` on the API — otherwise
    // next/image blocks uploaded photos at runtime.
    NEXT_PUBLIC_STORAGE_HOSTNAME: assertEnv(
        process.env.NEXT_PUBLIC_STORAGE_HOSTNAME,
        'NEXT_PUBLIC_STORAGE_HOSTNAME'
    ),
} as const;

export const PAYMENTS_SUBSCRIPTION_ENABLED =
    assertEnv(
        process.env.NEXT_PUBLIC_PAYMENTS_SUBSCRIPTION_ENABLED,
        'NEXT_PUBLIC_PAYMENTS_SUBSCRIPTION_ENABLED'
    ) === 'true';

export const PAYMENTS_ONE_OFF_ENABLED =
    assertEnv(
        process.env.NEXT_PUBLIC_PAYMENTS_ONE_OFF_ENABLED,
        'NEXT_PUBLIC_PAYMENTS_ONE_OFF_ENABLED'
    ) === 'true';

// Демо-банер на сторінці білінгу (тестова картка, "кошти не списуються").
// Тільки для sandbox-стадії WayForPay; у проді МУСИТЬ бути 'false', інакше
// реальним користувачам показується хибне твердження про відсутність списань.
export const BILLING_DEMO_MODE =
    assertEnv(
        process.env.NEXT_PUBLIC_BILLING_DEMO_MODE,
        'NEXT_PUBLIC_BILLING_DEMO_MODE'
    ) === 'true';
