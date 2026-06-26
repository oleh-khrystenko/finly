import { ForbiddenException } from '@nestjs/common';
import {
    RESPONSE_CODE,
    isAccessLevelAtLeast,
    type AccessLevel,
    type ResponseCode,
} from '@finly/types';

/**
 * Спільний замок платних фіч: кидає `ForbiddenException` з machine-readable
 * `code`, якщо рівень доступу нижче потрібного. Узагальнення наявного slug-замка
 * (Sprint 19) — кожна платна фіча з ЖОРСТКИМ відмовленням передає свій код для
 * специфічного upsell-копірайту на фронті.
 *
 * Не для м'якого гейтингу: фічі, що замість відмови деградують (бренд — зберегти
 * у pending + пейвол-стан у успішній відповіді; публічний рендер — fallback на
 * Finly), питають предикат `isAccessLevelAtLeast` напряму, а не цей throw.
 */
export function assertAccessLevelAtLeast(
    actorLevel: AccessLevel,
    required: AccessLevel,
    code: ResponseCode,
    message: string
): void {
    if (!isAccessLevelAtLeast(actorLevel, required)) {
        throw new ForbiddenException({ code, message });
    }
}

/**
 * Замок на редагування vanity-slug (бізнес/рахунок/інвойс): рівень доступу не
 * нижче brand. Спільний для трьох доменних сервісів — кастомне ім'я як платна
 * фіча однакове на всіх рівнях матрьошки. На Free slug автозгенерований на
 * create. Скидання на свіже випадкове посилання (reset-slug) НЕ під цим замком —
 * це гігієна/ротація адреси, доступна всім рівням.
 */
export function assertSlugEditAllowed(actorLevel: AccessLevel): void {
    assertAccessLevelAtLeast(
        actorLevel,
        'brand',
        RESPONSE_CODE.SLUG_EDIT_REQUIRES_PLAN,
        'Slug editing requires a paid plan'
    );
}
