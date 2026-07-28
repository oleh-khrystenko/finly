import { SetMetadata } from '@nestjs/common';

export const USER_RATE_LIMIT_KEY = 'user_rate_limit';

export interface UserRateLimitOptions {
    /**
     * Простір лічильника. Роути з одним `bucket` ділять ліміт, з різними —
     * рахуються окремо.
     */
    bucket: string;
    /** Максимум запитів одного користувача за вікно. */
    limit: number;
    /** Довжина вікна в секундах. */
    windowSec: number;
}

/**
 * Per-user ліміт частоти для кабінетних роутів.
 *
 * **Чому не `@Throttler`.** Вбудований throttler рахує по IP, а кабінетні запити
 * доходять до API через rewrite web-контейнера (`NEXT_PUBLIC_API_URL=/api` →
 * `API_INTERNAL_URL`), тож усі користувачі приходять з однієї адреси: IP-бакет на
 * кабінеті — це один спільний лічильник на весь продукт. Саме тому кабінетні
 * контролери його свідомо скіпають (`skipThrottlersExcept()`), а роути, яким
 * ліміт справді потрібен, беруть цей декоратор.
 *
 * Працює лише після guard-а, що кладе користувача у `request.user`
 * (`JwtActiveGuard`), і вимагає `UserRateLimitGuard` у `@UseGuards` роута.
 */
export const UserRateLimit = (options: UserRateLimitOptions) =>
    SetMetadata(USER_RATE_LIMIT_KEY, options);
