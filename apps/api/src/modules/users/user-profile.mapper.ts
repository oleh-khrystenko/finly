import {
    DEFAULT_USER_ROLE,
    type UserBilling,
    type UserProfile,
} from '@finly/types';

import type { UserDocument } from './schemas/user.schema';

/**
 * Single source of truth для shape профілю в API-відповідях, що повертають
 * `UserProfileSchema` (`getMe`, `updateProfile`, `loginWithPassword`,
 * `verifyMagicLink`).
 *
 * Поля `role` і `worksAsBookkeeper` нормалізуються через `??`-fallback:
 * Mongoose `default` працює лише на insert, тож legacy documents без полів
 * отримують sane defaults на read-time без міграції БД.
 *
 * Billing шейп — повний `UserBillingSchema`: усі 14 полів. Раніше API скорочувало
 * до 8, але це розходилось з shared контрактом (`packages/types/src/contracts/
 * payments.ts:UserBillingSchema`); тепер shape симетричний.
 */
export function mapUserToProfileResponse(user: UserDocument): UserProfile {
    return {
        id: user._id.toString(),
        email: user.email,
        role: user.role ?? DEFAULT_USER_ROLE,
        worksAsBookkeeper: user.worksAsBookkeeper ?? false,
        profile: user.profile,
        executions: {
            balance: user.executions.balance,
            freeReportUsed: user.executions.freeReportUsed,
        },
        hasPassword: !!user.passwordHash,
        deletedAt: user.deletedAt ?? null,
        accountDeletionRequestedAt: user.accountDeletionRequestedAt ?? null,
        termsVersion: user.termsVersion ?? null,
        billing: user.billing
            ? {
                  provider: user.billing.provider,
                  providerCustomerId: user.billing.providerCustomerId,
                  providerSubscriptionId: user.billing.providerSubscriptionId,
                  planCode: user.billing.planCode,
                  currency: user.billing.currency,
                  subscriptionStatus: user.billing
                      .subscriptionStatus as UserBilling['subscriptionStatus'],
                  providerSubscriptionStatus:
                      user.billing.providerSubscriptionStatus,
                  currentPeriodEnd: user.billing.currentPeriodEnd,
                  cancelAtPeriodEnd: user.billing.cancelAtPeriodEnd,
                  hasActiveSubscription: user.billing.hasActiveSubscription,
                  lastProviderEventAt: user.billing.lastProviderEventAt,
                  scheduledPlanCode: user.billing.scheduledPlanCode ?? null,
                  scheduledChangeDate: user.billing.scheduledChangeDate ?? null,
              }
            : null,
    };
}
