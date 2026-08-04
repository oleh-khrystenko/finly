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
    // Sprint 3 §3.9 — public payment-page origin (`pay.finly.com.ua` prod
    // / `localhost:3001` dev). Cabinet UI використовує цей host для
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

function parseHost(value: string, name: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`❌ ${name} must be an absolute URL (got "${value}")`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`❌ ${name} must be an http(s) URL (got "${value}")`);
    }
    // `host`, не `hostname` — з портом. У dev публічна pay-зона відрізняється
    // від кабінету рівно портом, тож порт тут значущий.
    return url.host.toLowerCase();
}

/**
 * Sprint 30 — хост публічної pay-зони, похідний від конфігурації. Whitelist у
 * `publicHosts.ts` будується з цього значення, а не зі зашитого у код списку:
 * у dev pay-зона відрізняється від кабінету ЛИШЕ портом (`PAY_PORT`), тож
 * зашитий список розходився б з `.env` при кожній зміні порту — публічна
 * сторінка тихо ставала б 404-ом кабінету, а QR-коди вели б у нікуди.
 *
 * Ціна похідного значення — хибна конфігурація стає небезпечною: якби
 * pay-origin збігся з кабінетним, кабінет сам став би публічною зоною, і
 * `proxy.ts` Branch B почав би віддавати 404 на `/business` та `/auth/signin`,
 * тобто вхід зник би цілком. Тому інваріант перевіряється тут, на старті, а не
 * проявляється у браузері.
 */
function resolvePayPublicHost(): string {
    const cabinetHost = parseHost(
        ENV.NEXT_PUBLIC_BASE_URL,
        'NEXT_PUBLIC_BASE_URL'
    );
    const payHost = parseHost(
        ENV.NEXT_PUBLIC_PAY_PUBLIC_URL,
        'NEXT_PUBLIC_PAY_PUBLIC_URL'
    );
    if (cabinetHost === payHost) {
        throw new Error(
            `❌ NEXT_PUBLIC_PAY_PUBLIC_URL host "${payHost}" is identical to ` +
                'NEXT_PUBLIC_BASE_URL. The cabinet host would be treated as the ' +
                'public pay zone: /business and /auth/signin would answer 404 ' +
                'and nobody could sign in. In dev the two differ by port ' +
                '(WEB_PORT vs PAY_PORT), in prod by subdomain.'
        );
    }
    return payHost;
}

export const PAY_PUBLIC_HOST = resolvePayPublicHost();

// Демо-банер на сторінці білінгу (тестова картка, "кошти не списуються").
// Тільки для sandbox-стадії monobank; у проді МУСИТЬ бути 'false', інакше
// реальним користувачам показується хибне твердження про відсутність списань.
export const BILLING_DEMO_MODE =
    assertEnv(
        process.env.NEXT_PUBLIC_BILLING_DEMO_MODE,
        'NEXT_PUBLIC_BILLING_DEMO_MODE'
    ) === 'true';
