import { ForbiddenException } from '@nestjs/common';
import {
    RESPONSE_CODE,
    isAccessLevelAtLeast,
    type AccessLevel,
} from '@finly/types';

/**
 * Замок на редагування vanity-slug (бізнес/рахунок/інвойс): рівень доступу не
 * нижче brand. Спільний для трьох доменних сервісів — кастомне ім'я як платна
 * фіча однакове на всіх рівнях матрьошки. На Free slug автозгенерований на
 * create. Скидання на свіже випадкове посилання (reset-slug) НЕ під цим замком —
 * це гігієна/ротація адреси, доступна всім рівням.
 */
export function assertSlugEditAllowed(actorLevel: AccessLevel): void {
    if (!isAccessLevelAtLeast(actorLevel, 'brand')) {
        throw new ForbiddenException({
            code: RESPONSE_CODE.SLUG_EDIT_REQUIRES_PLAN,
            message: 'Slug editing requires a paid plan',
        });
    }
}
