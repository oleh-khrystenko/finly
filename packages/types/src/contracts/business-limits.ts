import type { BusinessType } from '../enums/business-type';
import { isAccessLevelAtLeast, type AccessLevel } from './payments';

/**
 * Sprint 19 — ліміти створення бізнесів. Single source of truth для обох
 * сторін: API enforce-ить (`BusinessesService.assertWithinBusinessLimit`
 * кидає 403 за вердиктом), web попереджає заздалегідь (type-picker
 * `/business/new` гасить/маркує картки до заповнення форми). Дублювання
 * правил на web гарантовано дрейфувало б від сервісних констант.
 *
 * Дві осі:
 *  - **Власні** (ownerId=userId), per-тип:
 *    - фізособа / ФОП: завжди максимум 1 — доменний інваріант, не апсел
 *      (`reason: 'type-limit'`);
 *    - ТОВ / організація: 1 на none/brand, без ліміту на bookkeeper
 *      (`reason: 'requires-plan'` — знімається тарифом).
 *  - **Клієнтські** (bookkeeper-режим, ownerless): усі типи разом до
 *    `CLIENT_BUSINESS_LIMIT` на none/brand, без ліміту на bookkeeper.
 */

export const OWNED_FOUNDATIONAL_TYPE_LIMIT = 1; // власні фізособа / ФОП
export const OWNED_SCALE_TYPE_LIMIT_BELOW_BOOKKEEPER = 1; // власні ТОВ / організація
export const CLIENT_BUSINESS_LIMIT = 10; // клієнтські бізнеси до bookkeeper

export type BusinessCreationVerdict =
    | { allowed: true }
    | { allowed: false; reason: 'type-limit' | 'requires-plan' };

export function evaluateOwnedBusinessCreation(
    type: BusinessType,
    ownedCountOfType: number,
    accessLevel: AccessLevel
): BusinessCreationVerdict {
    if (type === 'individual' || type === 'fop') {
        return ownedCountOfType >= OWNED_FOUNDATIONAL_TYPE_LIMIT
            ? { allowed: false, reason: 'type-limit' }
            : { allowed: true };
    }
    if (isAccessLevelAtLeast(accessLevel, 'bookkeeper')) {
        return { allowed: true };
    }
    return ownedCountOfType >= OWNED_SCALE_TYPE_LIMIT_BELOW_BOOKKEEPER
        ? { allowed: false, reason: 'requires-plan' }
        : { allowed: true };
}

export function evaluateClientBusinessCreation(
    clientCount: number,
    accessLevel: AccessLevel
): BusinessCreationVerdict {
    if (isAccessLevelAtLeast(accessLevel, 'bookkeeper')) {
        return { allowed: true };
    }
    return clientCount >= CLIENT_BUSINESS_LIMIT
        ? { allowed: false, reason: 'requires-plan' }
        : { allowed: true };
}
