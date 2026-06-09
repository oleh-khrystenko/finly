import {
    DEFAULT_USER_ROLE,
    type AccessLevel,
    type UserBilling,
    type UserProfile,
} from '@finly/types';

import { resolveAccessLevel } from '../../common/billing/resolve-access-level';
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
 * Billing шейп — `UserBillingSchema` (public). Свідомо НЕ містить
 * provider-secret поля `recToken` і внутрішніх ordering-полів
 * (`orderReference`, `lastProviderEventAt`, `providerSubscriptionStatus`):
 * вони лишаються тільки на боці API. Кожне поле — explicit pick, тож секрети
 * не протікають за замовчуванням.
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
        pendingPostLoginTarget: user.pendingPostLoginTarget,
        billing: user.billing
            ? {
                  provider: user.billing.provider,
                  planCode: user.billing.planCode,
                  currency: user.billing.currency,
                  subscriptionStatus: user.billing
                      .subscriptionStatus as UserBilling['subscriptionStatus'],
                  currentPeriodEnd: user.billing.currentPeriodEnd,
                  cancelAtPeriodEnd: user.billing.cancelAtPeriodEnd,
                  hasActiveSubscription: user.billing.hasActiveSubscription,
                  scheduledPlanCode: user.billing.scheduledPlanCode ?? null,
                  scheduledChangeDate: user.billing.scheduledChangeDate ?? null,
                  cardMask: user.billing.cardMask ?? null,
                  oneOffLevel:
                      (user.billing.oneOffLevel as AccessLevel | null) ?? null,
                  oneOffAccessUntil: user.billing.oneOffAccessUntil ?? null,
                  accessLevel: resolveAccessLevel(user.billing),
              }
            : null,
    };
}
