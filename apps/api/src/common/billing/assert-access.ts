import { ForbiddenException } from '@nestjs/common';
import { RESPONSE_CODE } from '@finly/types';

/**
 * Sprint 27 — замок на редагування vanity-slug (бізнес / реквізити / рахунок):
 * бізнес мусить бути брендованим (прикріплений до активного Бренд-складу
 * платника). Гейтинг переїхав з рівня користувача на рівень бізнесу: `isBranded`
 * — денормалізований прапор `Business.brandedAt != null`, який тримає
 * реконсиляція per-business. Скидання на свіже випадкове посилання (reset-slug)
 * НЕ під цим замком — це гігієна/ротація адреси, доступна завжди.
 */
export function assertSlugEditAllowed(isBranded: boolean): void {
    if (!isBranded) {
        throw new ForbiddenException({
            code: RESPONSE_CODE.SLUG_EDIT_REQUIRES_PLAN,
            message: 'Slug editing requires an active Brand package',
        });
    }
}
