import { PAY_PUBLIC_HOST } from './env';

/**
 * Sprint 3 §3.9 — whitelist хостів для публічної зони (`pay.finly.com.ua` у
 * проді). Shared між middleware (host-aware routing) і Server Component
 * (`headers().get('host')` defense-in-depth check).
 *
 * **Джерело правди одне — `NEXT_PUBLIC_PAY_PUBLIC_URL`.** До Sprint 30 список
 * був зашитий у код і його доводилось тримати узгодженим з конфігурацією
 * вручну. Після переїзду dev-середовища на порти це стало пасткою: pay-зона
 * відрізняється від кабінету ЛИШЕ портом (`PAY_PORT` у `.env`), тож зміна
 * порту розсинхронізувала б список і мовчки перетворила публічну сторінку на
 * 404 кабінету, а QR-коди вели б у нікуди. Похідне значення виключає таке
 * розходження за побудовою; інваріант «pay-хост ≠ кабінетний хост» перевіряє
 * `resolvePayPublicHost` у `./env` на старті.
 *
 * Local dev: pay-зона слухає ІНШИЙ ПОРТ того самого `localhost` (той самий
 * Next.js container, другий port-mapping у `docker-compose.dev.yml`), а не
 * окремий піддомен. Причина — Google OAuth: він приймає redirect-адресу лише
 * на публічному TLD або на `localhost`, тож вигаданий dev-домен на кшталт
 * `finly.local` зробив би вхід через Google локально неможливим. Для сесії
 * порт нешкідливий: cookie-scope портами не розділяється (RFC 6265 §8.5),
 * тому cookie з `Domain=localhost` видно обом портам — спільна сесія працює
 * так само, як у проді між `finly.com.ua` і `pay.finly.com.ua`.
 *
 * Prod — DNS-record на той самий backend + nginx-route, що проксує обидва
 * домени на один Next.js container.
 */
export const PUBLIC_HOSTS: readonly string[] = [PAY_PUBLIC_HOST];

/**
 * Host comparison **case-insensitive** за RFC 7230 §2.7: domain component
 * у HTTP host header є case-insensitive. Browsers зазвичай надсилають
 * lowercase, але reverse-proxy / curl / нестандартні клієнти можуть слати
 * mixed або UPPER case. Strict-eq тут зламав би host-isolation §3.9 —
 * `PAY.FINLY.COM.UA` обійшов би Branch B middleware, потрапив у cabinet
 * pass-through і отримав би валідну відповідь на `/auth/signin` чи інші
 * cabinet route-и.
 *
 * `PUBLIC_HOSTS` уже нормалізований до lowercase у `./env` (canonical form);
 * нормалізуємо input перед comparison.
 */
export function isPublicHost(host: string | null | undefined): boolean {
    if (!host) return false;
    const lower = host.toLowerCase();
    return PUBLIC_HOSTS.includes(lower);
}
