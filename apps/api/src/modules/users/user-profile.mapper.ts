import {
    DEFAULT_USER_ROLE,
    type SlugReservationView,
    type UserProfile,
} from '@finly/types';

import type { UserDocument } from './schemas/user.schema';

/**
 * Single source of truth для shape профілю в API-відповідях, що повертають
 * `UserProfileSchema` (`getMe`, `updateProfile`, `loginWithPassword`,
 * `verifyMagicLink`).
 *
 * Поля `role` і `worksAsBookkeeper` нормалізуються через `??`-fallback:
 * Mongoose `default` працює лише на insert, тож legacy documents отримують sane
 * defaults на read-time без міграції.
 *
 * Sprint 27 — білінг більше НЕ в профілі користувача: він переїхав у окрему
 * сутність `BillingProfile` і віддається окремим ендпоінтом `GET
 * /payments/profile` (`BillingProfileView`). Це розв'язує циклічність
 * Users↔Payments і чисто відділяє білінг від профілю. «Виконання» знесені.
 */
export function mapUserToProfileResponse(
    user: UserDocument,
    // Sprint 20 — активна бронь slug (top-level). Передається лише з `getMe`.
    activeSlugReservation: SlugReservationView | null = null
): UserProfile {
    return {
        id: user._id.toString(),
        activeSlugReservation,
        email: user.email,
        role: user.role ?? DEFAULT_USER_ROLE,
        worksAsBookkeeper: user.worksAsBookkeeper ?? false,
        profile: user.profile,
        hasPassword: !!user.passwordHash,
        deletedAt: user.deletedAt ?? null,
        accountDeletionRequestedAt: user.accountDeletionRequestedAt ?? null,
        termsVersion: user.termsVersion ?? null,
        pendingPostLoginTarget: user.pendingPostLoginTarget,
    };
}
