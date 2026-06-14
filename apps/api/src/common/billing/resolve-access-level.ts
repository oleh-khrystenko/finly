import { deriveAccessLevel, type AccessLevel } from '@finly/types';

/**
 * Білінг-субдок користувача (structural, без імпорту схеми users-модуля) у
 * формі, достатній для обчислення рівня доступу. `oneOffLevel` зберігається як
 * `string | null` (Mongo), але реально приймає лише `AccessLevel`-значення —
 * звужуємо тут одним місцем замість cast-у на кожному callsite.
 */
type BillingLike = {
    planCode: string | null;
    hasActiveSubscription: boolean;
    subscriptionStatus: string | null;
    oneOffLevel: string | null;
    oneOffAccessUntil: Date | null;
} | null;

/**
 * Єдина точка маппінгу білінг-стану користувача у рівень доступу для API-замків
 * (slug-гейт, ліміти бізнесів) і серіалізації профілю. Делегує доменну логіку
 * `deriveAccessLevel` (shared single source); тут лише адаптація Mongo-shape.
 */
export function resolveAccessLevel(
    billing: BillingLike,
    now: Date = new Date()
): AccessLevel {
    if (!billing) return 'none';
    return deriveAccessLevel(
        {
            planCode: billing.planCode,
            hasActiveSubscription: billing.hasActiveSubscription,
            subscriptionStatus: billing.subscriptionStatus,
            oneOffLevel: billing.oneOffLevel as AccessLevel | null,
            oneOffAccessUntil: billing.oneOffAccessUntil,
        },
        now
    );
}
