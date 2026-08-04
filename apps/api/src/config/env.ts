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

function hostnameOf(rawUrl: string, name: string): string {
    try {
        return new URL(rawUrl).hostname;
    } catch {
        throw new Error(`❌ ${name} must be an absolute URL (got "${rawUrl}")`);
    }
}

// Шлях OAuth-callback-у задає контролер (`GET /auth/google/callback` під
// глобальним префіксом `/api`), тому окремою змінною він бути не може: у `.env`
// це був просто `WEB_URL` + константа, яку легко розсинхронити.
const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback';

const webUrl = getEnvVar('WEB_URL');

export const ENV = {
    NODE_ENV: getEnvVar('NODE_ENV'),
    API_PORT: getEnvVar('API_PORT'),
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
    WEB_URL: webUrl,
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
     * Батьківський домен сесійної cookie — хост кабінету (`finly.com.ua` prod,
     * `localhost` dev). Кабінет і pay-хост живуть під ним, тож браузер шле
     * `bid_refresh` на обидва: один вхід, один вихід.
     *
     * Похідне від `WEB_URL`, а не окрема змінна: два незалежні значення
     * розсинхронізувалися б мовчки (браузер просто відкидає `Set-Cookie`, і
     * сесії немає ні на одному хості). Умову «pay-хост лежить під цим доменом»
     * перевіряє fail-fast нижче.
     */
    AUTH_COOKIE_DOMAIN: hostnameOf(webUrl, 'WEB_URL'),

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
    GOOGLE_CALLBACK_URL: `${webUrl.replace(/\/$/, '')}${GOOGLE_CALLBACK_PATH}`,

    RESEND_API_KEY: getEnvVar('RESEND_API_KEY'),
    RESEND_FROM_EMAIL: getEnvVar('RESEND_FROM_EMAIL'),

    // monobank «Плата» (Sprint 22) — merchant X-Token із кабінету monobank
    // (або тестовий токен з api.monobank.ua). Єдиний секрет провайдера:
    // checkout, списання за токеном і запит статусу автентифікуються ним;
    // вебхуки верифікуються публічним ключем з GET /api/merchant/pubkey.
    MONOBANK_TOKEN: getEnvVar('MONOBANK_TOKEN'),

    // Google Search Console (органічні кліки на гайди). Сервіс-акаунт: email +
    // приватний ключ PEM (у .env одним рядком з екранованими `\n` — розгортаємо
    // назад перед підписанням JWT). GSC_SITE_URL — property Search Console
    // (`sc-domain:...` або `https://.../`).
    GSC_SITE_URL: getEnvVar('GSC_SITE_URL'),
    GSC_CLIENT_EMAIL: getEnvVar('GSC_CLIENT_EMAIL'),
    GSC_PRIVATE_KEY: getEnvVar('GSC_PRIVATE_KEY').replace(/\\n/g, '\n'),

    ANTHROPIC_API_KEY: getEnvVar('ANTHROPIC_API_KEY'),

    // Cloudflare R2 — media storage (presigned uploads, Google avatar re-upload).
    // Хост цього URL web бере собі для `next/image` remotePatterns напряму
    // (`next.config.ts`), тож окремої змінної під нього не існує.
    R2_ACCOUNT_ID: getEnvVar('R2_ACCOUNT_ID'),
    R2_ACCESS_KEY_ID: getEnvVar('R2_ACCESS_KEY_ID'),
    R2_SECRET_ACCESS_KEY: getEnvVar('R2_SECRET_ACCESS_KEY'),
    R2_BUCKET_NAME: getEnvVar('R2_BUCKET_NAME'),
    R2_PUBLIC_URL: getEnvVar('R2_PUBLIC_URL'),
};

// Спільна сесія двох хостів тримається на одному інваріанті: хост, що читає
// сесійну cookie, мусить лежати під її доменом. Домен беремо з кабінету, тож
// кабінет і Google-callback під ним за побудовою — перевіряти лишається
// pay-хост. Якщо він виїде з-під домену (наприклад, кабінет переїде на
// піддомен), браузер мовчки відкидатиме `Set-Cookie` на pay-зоні: вхід ніби
// проходить, а сесії там немає, і жодної помилки в логах. Тому — на старті.
export function assertHostUnderCookieDomain(
    cookieDomain: string,
    name: string,
    origin: string
): void {
    let hostname: string;
    try {
        hostname = new URL(origin).hostname;
    } catch {
        throw new Error(
            `❌ ${name} must be an absolute URL (got "${origin}").`
        );
    }
    if (hostname !== cookieDomain && !hostname.endsWith(`.${cookieDomain}`)) {
        throw new Error(
            `❌ ${name} host "${hostname}" is not under the session cookie domain ` +
                `"${cookieDomain}" (derived from WEB_URL). The browser would silently ` +
                'drop the session cookie, leaving that host logged out.'
        );
    }
}

assertHostUnderCookieDomain(
    ENV.AUTH_COOKIE_DOMAIN,
    'PAY_PUBLIC_URL',
    ENV.PAY_PUBLIC_URL
);
