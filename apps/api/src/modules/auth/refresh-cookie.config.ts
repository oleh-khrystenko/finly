import { CookieOptions, Response } from 'express';

import { ENV } from '../../config/env';

export const REFRESH_COOKIE_NAME = 'bid_refresh';

export function resolveRefreshCookieDomain(
    cookieDomain: string
): string | undefined {
    return cookieDomain === 'localhost' ? undefined : cookieDomain;
}

const refreshCookieDomain = resolveRefreshCookieDomain(ENV.AUTH_COOKIE_DOMAIN);
const REFRESH_COOKIE_DOMAIN_OPTIONS: CookieOptions = refreshCookieDomain
    ? { domain: refreshCookieDomain }
    : {};

/**
 * Sprint 30 — сесія спільна для кабінету і pay-хоста: cookie прив'язана до
 * батьківського домену (`AUTH_COOKIE_DOMAIN`), тож браузер шле її на обидва
 * наші хости. У dev обидві зони мають hostname `localhost` і різняться лише
 * портом, тому cookie лишається host-only: `Domain=localhost` браузери можуть
 * відхилити, а порт до cookie-scope однаково не входить.
 */
export const REFRESH_COOKIE_OPTIONS: CookieOptions = {
    httpOnly: true,
    secure: ENV.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    ...REFRESH_COOKIE_DOMAIN_OPTIONS,
    maxAge: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Атрибути для видалення cookie нового зразка (з доменом). `maxAge` тут зайвий:
 * `clearCookie` виставляє власний `Expires` у минуле, а решта атрибутів мусить
 * збігатися з тими, з якими cookie ставилась, інакше браузер її не зачепить.
 */
const CLEAR_OPTIONS: CookieOptions = {
    httpOnly: true,
    secure: ENV.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    ...REFRESH_COOKIE_DOMAIN_OPTIONS,
};

/**
 * Атрибути cookie СТАРОГО зразка (до Sprint 30) — без `domain`, тобто host-only
 * на кабінетному хості. Видалення мусить повторювати саме їх: команда з новим
 * `Domain=` стару cookie не зачіпає, це різні записи у сховищі браузера.
 *
 * Навіщо: у браузері вже залогіненого користувача після релізу лежать дві
 * cookie з одним іменем. Браузер надішле обидві, сервер прочитає стару з
 * недійсним ключем, а захист від повторного використання refresh-токена
 * сприйме це як атаку і вб'є щойно створену сесію — людина застрягне у циклі
 * перелогінів. Тому кожна відповідь, що ставить або чистить сесійну cookie,
 * додатково гасить стару.
 *
 * Перехідна поведінка живе щонайменше стільки, скільки живе стара cookie
 * (тиждень, `maxAge` попереднього зразка), після чого її можна прибрати.
 */
const LEGACY_CLEAR_OPTIONS: CookieOptions = {
    httpOnly: true,
    secure: ENV.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
};

// На localhost попередня версія ставила `Domain=localhost`: частина браузерів
// її відкидала, а частина могла зберегти як окремий domain-scoped запис. Тому
// локально гасимо саме цей запис перед встановленням правильної host-only
// cookie; у проді лишається перехідне видалення старої host-only cookie.
const STALE_COOKIE_CLEAR_OPTIONS: CookieOptions = refreshCookieDomain
    ? LEGACY_CLEAR_OPTIONS
    : {
          ...LEGACY_CLEAR_OPTIONS,
          domain: ENV.AUTH_COOKIE_DOMAIN,
      };

/**
 * Ставить сесійну cookie і одночасно гасить cookie старого зразка. Єдина точка
 * запису — усі auth-флоу (вхід паролем, Google, magic-link, зміна пароля,
 * ротація) проходять через неї, тож перехідне видалення не можна забути на
 * окремому шляху.
 */
export function setRefreshCookie(res: Response, refreshToken: string): void {
    res.clearCookie(REFRESH_COOKIE_NAME, STALE_COOKIE_CLEAR_OPTIONS);
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, REFRESH_COOKIE_OPTIONS);
}

/** Гасить обидва зразки cookie: вихід, провал ротації, видалення акаунта. */
export function clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, CLEAR_OPTIONS);
    res.clearCookie(REFRESH_COOKIE_NAME, STALE_COOKIE_CLEAR_OPTIONS);
}
