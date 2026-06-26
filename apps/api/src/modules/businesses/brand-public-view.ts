import type { BusinessBrand } from '@finly/types';

/**
 * Sprint 21 — публічні поля бренду для pay-сторінок (логотип + косметична назва).
 *
 * Гейтинг = довіра активному слоту (як публічний QR-рендер, Блок 3): віддаємо
 * бренд тоді й лише тоді, коли заповнений `brand.active`. Актуальність слота
 * тримає реконсиляція, тож «нижче brand → Finly» виконується без live-білінгу.
 * Поля опускаються (не `null`-логотип) за відсутності активного бренду — щоб
 * whitelist-форма публічної view лишалась мінімальною.
 */
export function buildPublicBrandView(business: {
    brand?: BusinessBrand | null;
}): { logo?: string; brandDisplayName?: string | null } {
    const active = business.brand?.active;
    if (!active) return {};
    return { logo: active.logoUrl, brandDisplayName: active.displayName };
}
