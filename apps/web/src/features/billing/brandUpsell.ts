import { SUBSCRIPTION_PLANS } from '@finly/types';
import { createSubscriptionCheckout } from '@/shared/api';

/**
 * Sprint 20 — спільний апсел на тариф «Свій бренд» (slug-flow на трьох
 * сторінках). Ціна деривується з каталогу (`SUBSCRIPTION_PLANS`), а не
 * хардкодиться, щоб не розійтися з білінгом.
 */
const BRAND_PLAN = SUBSCRIPTION_PLANS.find((p) => p.code === 'brand');

/** Підпис primary CTA: «Підписатись · 49 грн/міс». */
export function brandUpsellCtaLabel(): string {
    const amount = BRAND_PLAN ? Math.round(BRAND_PLAN.priceAmount / 100) : 0;
    return `Підписатись · ${amount} грн/міс`;
}

/**
 * Прямий checkout підписки «Свій бренд» з поверненням на `returnPath` (сторінка
 * сутності, де чекає бронь). Після оплати намір застосовується автоматично
 * (`useApplyPendingSlug`). Кидає — caller показує toast і лишає бронь чинною.
 */
export async function startBrandCheckout(returnPath: string): Promise<void> {
    const { checkoutUrl } = await createSubscriptionCheckout('brand', returnPath);
    window.location.href = checkoutUrl;
}
