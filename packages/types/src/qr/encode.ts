/**
 * Кодування payload-рядка в Base64URL — isomorphic, без `Buffer`.
 *
 * Чому без `Buffer`: `packages/types` консумується і API (Node), і web (Next.js
 * у браузері). У браузері `Buffer` недоступний нативно — без bundler-shim це
 * `ReferenceError` або silent-broken polyfill. `TextEncoder` і `btoa`
 * доступні в Node ≥18 і всіх сучасних браузерах нативно — нульова залежність.
 *
 * Алгоритм за RFC 4648 §5 (Base64URL): стандартний Base64 з заміною
 * `+` → `-`, `/` → `_`, видалення padding `=`.
 */
export function encodePayloadAsBase64Url(payload: string): string {
    const bytes = new TextEncoder().encode(payload);
    // btoa приймає рядок з code points 0..255, тому конвертуємо bytes у
    // 'binary string' посимвольно. fromCharCode(0..255) детерміновано
    // створює один-байтовий character у latin-1 області.
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}
