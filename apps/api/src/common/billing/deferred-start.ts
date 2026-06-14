import { SUBSCRIPTION_STATUS } from '@finly/types';

/**
 * Sprint 19 — grace для deferred-старту підписки поверх one-off. Поки підписка
 * у TRIALING чекає Approved першого списання (WayForPay списує у день
 * `currentPeriodEnd`, ретраї declined можуть зсунути на години-дні), користувач
 * формально на рівні none: TRIALING свідомо не зараховується у
 * `deriveAccessLevel`, а one-off уже сплив. Реконсиляція у цьому вікні скинула б
 * кастомні slug-и того, хто вже оплатив продовження. Approved → ACTIVE →
 * наступний тригер підбирає; Declined → PAST_DUE → теж виходить з-під
 * виключення. Якщо за grace списання так і не сталося (кинутий
 * deferred-checkout) — обробляємо як звичайний сплив.
 *
 * Константу ділять обидва guard-и вікна: `$nor`-фільтр cron-сплину one-off
 * (`PaymentsCleanupService.expireOneOffAccess`) і предикат нижче для решти
 * reconcile-тригерів (`ReconciliationService.reconcile`).
 */
export const DEFERRED_START_FIRST_CHARGE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Білінг-субдок structural (без імпорту users-схеми) — ті ж поля, що читає
 * `$nor`-фільтр cron-а.
 */
type DeferredStartBillingLike = {
    hasActiveSubscription: boolean;
    subscriptionStatus: string | null;
    currentPeriodEnd: Date | null;
    oneOffLevel: string | null;
    oneOffAccessUntil: Date | null;
} | null;

/**
 * Чи у вікні «one-off сплив, перше deferred-списання підписки ще не прийшло».
 * JS-дзеркало `$nor`-гілки cron-а: one-off-поля ще стоять (cron їх у вікні не
 * чистить) з датою у минулому, підписка TRIALING з `currentPeriodEnd` не
 * старішим за grace. Refund one-off сюди не потрапляє — refund-вебхук чистить
 * one-off-поля, і рівень none стає легітимним (гроші повернуто).
 */
export function isAwaitingDeferredFirstCharge(
    billing: DeferredStartBillingLike,
    now: Date
): boolean {
    if (!billing) return false;
    const oneOffLapsed =
        billing.oneOffLevel != null &&
        billing.oneOffAccessUntil != null &&
        billing.oneOffAccessUntil.getTime() <= now.getTime();
    if (!oneOffLapsed) return false;
    return (
        billing.hasActiveSubscription &&
        billing.subscriptionStatus === SUBSCRIPTION_STATUS.TRIALING &&
        billing.currentPeriodEnd != null &&
        billing.currentPeriodEnd.getTime() >=
            now.getTime() - DEFERRED_START_FIRST_CHARGE_GRACE_MS
    );
}
