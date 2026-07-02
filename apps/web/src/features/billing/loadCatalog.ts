import { paymentsCatalogSchema, type PaymentsCatalog } from '@finly/types';

/**
 * Server-side fetch каталогу для structured-data offers на лендінгу (Server
 * Component). Реальні ціни живуть тільки на API (накладаються з ENV), тож
 * розмітка бере їх з того ж публічного ендпоінта, що й сторінка тарифів, —
 * одне джерело правди, ціна в offers завжди збігається з тарифами.
 *
 * `API_INTERNAL_URL` (не `NEXT_PUBLIC_API_URL`): server-side у docker-compose
 * рендер ходить на internal-host напряму, без Next.js `/api` proxy hop —
 * той самий патерн, що `loadPublicView`.
 *
 * `revalidate` (не `no-store`): ціни майже статичні (env-driven, змінюються лише
 * на деплой), тож лендінг лишається ISR-кешованим замість повного SSR щоразу.
 *
 * Повертає `null` замість throw при будь-якому збої (включно з невиставленим
 * `API_INTERNAL_URL`): offers — необовʼязкове збагачення розмітки, а маркетингова
 * головна не повинна падати ні через недоступний білінг-сервіс, ні через
 * конфіг. У такому разі offers просто опускаються з графа.
 */
const CATALOG_REVALIDATE_SEC = 3600;

export async function loadCatalog(): Promise<PaymentsCatalog | null> {
    const apiBase = process.env.API_INTERNAL_URL;
    if (!apiBase) return null;
    try {
        const res = await fetch(`${apiBase}/api/payments/catalog`, {
            next: { revalidate: CATALOG_REVALIDATE_SEC },
            headers: { Accept: 'application/json' },
        });
        if (!res.ok) return null;
        const json = (await res.json()) as { data: unknown };
        return paymentsCatalogSchema.parse(json.data);
    } catch {
        return null;
    }
}
