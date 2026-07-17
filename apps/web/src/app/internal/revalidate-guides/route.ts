import { timingSafeEqual } from 'node:crypto';

import { revalidateTag } from 'next/cache';

import { GUIDES_CACHE_TAG } from '@/features/guides';

/**
 * Constant-time bearer match: a plain `===` leaks the correct prefix length
 * through response timing. Different lengths short-circuit (не порівнюємо
 * буфери різної довжини — `timingSafeEqual` кинув би).
 */
function bearerMatches(header: string, expected: string): boolean {
    const headerBuf = Buffer.from(header);
    const expectedBuf = Buffer.from(expected);
    if (headerBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(headerBuf, expectedBuf);
}

/**
 * Sprint 28 — internal on-demand revalidation, викликається API після
 * адмін-публікації гайда. Живе поза `/api/*` (той префікс reverse-proxy-иться
 * на бекенд), звіряє спільний секрет і скидає кеш гайдів.
 *
 * `REVALIDATE_SECRET` читається напряму з `process.env` (server-only, не
 * NEXT_PUBLIC), fail-fast якщо не заданий — як `API_INTERNAL_URL` у публічних
 * лоадерах.
 */
export async function POST(request: Request): Promise<Response> {
    const secret = process.env.REVALIDATE_SECRET;
    if (!secret) {
        throw new Error(
            '❌ REVALIDATE_SECRET is not defined (server-side env required for guides revalidation)'
        );
    }

    const auth = request.headers.get('authorization');
    if (!auth || !bearerMatches(auth, `Bearer ${secret}`)) {
        return new Response('Unauthorized', { status: 401 });
    }

    // Next 16 revalidateTag(tag, profile): виклик помічає тег stale негайно,
    // profile задає cache-life на наступний цикл.
    revalidateTag(GUIDES_CACHE_TAG, 'max');
    return new Response(JSON.stringify({ revalidated: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
