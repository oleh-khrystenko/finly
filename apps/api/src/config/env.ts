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

// Строгий integer-парсинг для security-критичних чисел: Express `trust proxy`
// мовчки трактує NaN як 0 (`i < NaN` завжди false), тож нечислове значення за
// реверс-проксі непомітно злило б усіх відвідувачів в один IP проксі замість
// crash-у на старті (fail-fast). Regex замість `parseInt`/`Number`: parseInt
// обрізає хвіст ("1abc" → 1), Number трактує whitespace як 0.
export const getNonNegativeIntEnvVar = (name: string): number => {
    const raw = getEnvVar(name);
    if (!/^\d+$/.test(raw)) {
        throw new Error(
            `❌ Environment variable "${name}" must be a non-negative integer (got "${raw}")`
        );
    }
    return Number(raw);
};

// Демо-режим білінгу. На проді з живими грошима МУСИТЬ бути false. Web-аналог:
// NEXT_PUBLIC_BILLING_DEMO_MODE (показує демо-банер на сторінці тарифу).
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
    TRUST_PROXY_HOPS: getNonNegativeIntEnvVar('TRUST_PROXY_HOPS'),
    /**
     * Cabinet origin (`finly.com.ua` prod, `localhost:3000` dev). Використовується
     * для CORS, OAuth callback, magic-link redirect, monobank return/service
     * URL, email-template посилань на кабінет — усі шляхи, що ведуть
     * авторизованого ФОП назад у його кабінет.
     */
    WEB_URL: getEnvVar('WEB_URL'),
    /**
     * Public payment-page origin (`pay.finly.com.ua` prod, `localhost:3001`
     * dev — другий port-mapping того самого web-контейнера, `PAY_PORT`;
     * записів у `/etc/hosts` не потрібно, див. Sprint 3 §3.9). Sprint 3
     * рішення A1: cabinet і public живуть на різних host-ах для cookie/auth
     * ізоляції. QR-картинка `/businesses/public/:slug/qr/business.png` кодує
     * URL клієнта (не ФОП-а) → це **public host**, не WEB_URL.
     */
    PAY_PUBLIC_URL: getEnvVar('PAY_PUBLIC_URL'),

    /**
     * Sprint 30 — батьківський домен сесійної cookie (`finly.com.ua` prod,
     * `localhost` dev). Кабінет і pay-хост живуть під ним, тож браузер шле
     * `bid_refresh` на обидва: один вхід, один вихід. Значення БЕЗ схеми, порту
     * і провідної крапки — це саме домен, не origin.
     *
     * Обов'язкова змінна без дефолту: мовчазний fallback (host-only cookie)
     * означав би тихо зламану спільну сесію в проді — pay-хост просто не бачив
     * би користувача, і жодна помилка про це не сказала б.
     */
    AUTH_COOKIE_DOMAIN: getEnvVar('AUTH_COOKIE_DOMAIN'),

    /**
     * Sprint 28 — спільний секрет для internal on-demand revalidation web-у.
     * Після адмін-публікації гайда API б'є `WEB_URL/internal/revalidate-guides`
     * з цим bearer-ом, а web-роут звіряє його перед `revalidateTag`. Мусить
     * збігатися зі значенням у web-контейнері.
     */
    REVALIDATE_SECRET: getEnvVar('REVALIDATE_SECRET'),

    MONGODB_URI: getEnvVar('MONGODB_URI'),
    JWT_ACCESS_SECRET: getEnvVar('JWT_ACCESS_SECRET'),
    JWT_REFRESH_SECRET: getEnvVar('JWT_REFRESH_SECRET'),
    REDIS_URL: getEnvVar('REDIS_URL'),

    GOOGLE_CLIENT_ID: getEnvVar('GOOGLE_CLIENT_ID'),
    GOOGLE_CLIENT_SECRET: getEnvVar('GOOGLE_CLIENT_SECRET'),
    GOOGLE_CALLBACK_URL: getEnvVar('GOOGLE_CALLBACK_URL'),

    RESEND_API_KEY: getEnvVar('RESEND_API_KEY'),
    RESEND_FROM_EMAIL: getEnvVar('RESEND_FROM_EMAIL'),

    // monobank «Плата» (Sprint 22) — merchant X-Token із кабінету monobank
    // (або тестовий токен з api.monobank.ua). Єдиний секрет провайдера:
    // checkout, списання за токеном і запит статусу автентифікуються ним;
    // вебхуки верифікуються публічним ключем з GET /api/merchant/pubkey.
    MONOBANK_TOKEN: getEnvVar('MONOBANK_TOKEN'),

    BILLING_DEMO_MODE: billingDemoMode,

    // Google Search Console (органічні кліки на гайди). Сервіс-акаунт: email +
    // приватний ключ PEM (у .env одним рядком з екранованими `\n` — розгортаємо
    // назад перед підписанням JWT). GSC_SITE_URL — property Search Console
    // (`sc-domain:...` або `https://.../`).
    GSC_SITE_URL: getEnvVar('GSC_SITE_URL'),
    GSC_CLIENT_EMAIL: getEnvVar('GSC_CLIENT_EMAIL'),
    GSC_PRIVATE_KEY: getEnvVar('GSC_PRIVATE_KEY').replace(/\\n/g, '\n'),

    ANTHROPIC_API_KEY: getEnvVar('ANTHROPIC_API_KEY'),

    // Cloudflare R2 — media storage (presigned uploads, Google avatar re-upload).
    // R2_PUBLIC_URL hostname MUST match NEXT_PUBLIC_STORAGE_HOSTNAME on the web
    // side — otherwise next/image rejects uploaded photos at runtime.
    R2_ACCOUNT_ID: getEnvVar('R2_ACCOUNT_ID'),
    R2_ACCESS_KEY_ID: getEnvVar('R2_ACCESS_KEY_ID'),
    R2_SECRET_ACCESS_KEY: getEnvVar('R2_SECRET_ACCESS_KEY'),
    R2_BUCKET_NAME: getEnvVar('R2_BUCKET_NAME'),
    R2_PUBLIC_URL: getEnvVar('R2_PUBLIC_URL'),
};

// Sprint 30 — спільна сесія двох хостів тримається на одному інваріанті: кожен
// хост, що ставить або читає сесійну cookie, мусить лежати під її доменом. Якщо
// це не так (класика: dev-кабінет лишився на `localhost`, а домен cookie вже
// `finly.local`), браузер мовчки відкидає `Set-Cookie` — вхід ніби проходить,
// але сесії немає ні на одному хості, і жодної помилки в логах. Тому
// перевіряємо на старті.
//
// Google-callback тут нарівні з хостами застосунку і саме тому, що він єдиний з
// них СТАВИТЬ cookie напряму з браузера: решта викликів API йдуть через rewrite
// web-контейнера, тобто з origin-у, вже перевіреного нижче. Callback поза
// доменом cookie давав би тихо зламаний вхід через Google при цілком робочому
// вході паролем — найдорожчий різновид збою, бо жодна помилка про нього не
// скаже.
export function validateAuthCookieDomain(
    cookieDomain: string,
    origins: Record<string, string>
): void {
    if (cookieDomain.startsWith('.') || cookieDomain.includes('/')) {
        throw new Error(
            `❌ AUTH_COOKIE_DOMAIN must be a bare domain without scheme, port or leading dot (got "${cookieDomain}").`
        );
    }
    for (const [name, origin] of Object.entries(origins)) {
        let hostname: string;
        try {
            hostname = new URL(origin).hostname;
        } catch {
            throw new Error(
                `❌ ${name} must be an absolute URL (got "${origin}").`
            );
        }
        if (
            hostname !== cookieDomain &&
            !hostname.endsWith(`.${cookieDomain}`)
        ) {
            throw new Error(
                `❌ ${name} host "${hostname}" is not under AUTH_COOKIE_DOMAIN ` +
                    `"${cookieDomain}". The browser would silently drop the session cookie, ` +
                    'leaving both hosts logged out.'
            );
        }
    }
}

validateAuthCookieDomain(ENV.AUTH_COOKIE_DOMAIN, {
    WEB_URL: ENV.WEB_URL,
    PAY_PUBLIC_URL: ENV.PAY_PUBLIC_URL,
    GOOGLE_CALLBACK_URL: ENV.GOOGLE_CALLBACK_URL,
});
