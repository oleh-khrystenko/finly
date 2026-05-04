/**
 * Sprint 3 §3.9 — whitelist хостів для публічної зони `pay.finly.com.ua`.
 * Shared між middleware (host-aware routing) і Server Component
 * (`headers().get('host')` defense-in-depth check).
 *
 * Local dev: запис у `/etc/hosts`:
 *   `127.0.0.1 pay.finly.local`
 * (інструкція у README репо). Prod — DNS-record на той самий backend
 * + nginx-route, що проксує обидва домени на один Next.js container.
 */
export const PUBLIC_HOSTS = [
    'pay.finly.com.ua',
    'pay.finly.local:3000',
] as const;

export type PublicHost = (typeof PUBLIC_HOSTS)[number];

/**
 * Host comparison **case-insensitive** за RFC 7230 §2.7: domain component
 * у HTTP host header є case-insensitive. Browsers зазвичай надсилають
 * lowercase, але reverse-proxy / curl / нестандартні клієнти можуть слати
 * mixed або UPPER case. Strict-eq тут зламав би host-isolation §3.9 —
 * `PAY.FINLY.COM.UA` обійшов би Branch B middleware, потрапив у cabinet
 * pass-through і отримав би валідну відповідь на `/auth/signin` чи інші
 * cabinet route-и.
 *
 * Whitelist `PUBLIC_HOSTS` оголошений у lowercase (canonical form);
 * нормалізуємо input перед comparison.
 */
export function isPublicHost(host: string | null | undefined): boolean {
    if (!host) return false;
    const lower = host.toLowerCase();
    return (PUBLIC_HOSTS as readonly string[]).includes(lower);
}
