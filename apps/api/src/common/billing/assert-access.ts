import { ForbiddenException } from '@nestjs/common';
import {
    RESPONSE_CODE,
    isAccessLevelAtLeast,
    type AccessLevel,
} from '@finly/types';

/**
 * Замок на редагування vanity-slug (бізнес/рахунок/інвойс) і його скидання:
 * рівень доступу не нижче brand. Спільний для трьох доменних сервісів — slug як
 * платна фіча однаковий на всіх рівнях матрьошки. На Free slug автозгенерований
 * на create і незмінний.
 */
export function assertSlugEditAllowed(actorLevel: AccessLevel): void {
    if (!isAccessLevelAtLeast(actorLevel, 'brand')) {
        throw new ForbiddenException({
            code: RESPONSE_CODE.SLUG_EDIT_REQUIRES_PLAN,
            message: 'Slug editing requires a paid plan',
        });
    }
}
