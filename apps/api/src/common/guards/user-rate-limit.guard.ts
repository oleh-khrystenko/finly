import {
    CanActivate,
    ExecutionContext,
    HttpException,
    HttpStatus,
    Injectable,
    InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RESPONSE_CODE } from '@finly/types';

import {
    USER_RATE_LIMIT_KEY,
    type UserRateLimitOptions,
} from '../decorators/user-rate-limit.decorator';
import { RedisCounterService } from '../services/redis-counter.service';
import type { UserDocument } from '../../modules/users/schemas/user.schema';

/**
 * Виконує ліміт, оголошений `@UserRateLimit(...)`, рахуючи запити per-user у
 * Redis (див. декоратор — чому не вбудований IP-throttler).
 *
 * Fixed-window: TTL ставиться на першому запиті і не подовжується наступними,
 * тож вікно завжди скінченне і користувач знає, що чекати не довше за
 * `windowSec`. Sliding-вікно (як у локаутах пароля) тут було б шкідливе:
 * легітимний швидкий набір тримав би блок живим, поки людина друкує.
 */
@Injectable()
export class UserRateLimitGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly redisCounter: RedisCounterService
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const options = this.reflector.getAllAndOverride<
            UserRateLimitOptions | undefined
        >(USER_RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);
        if (!options) return true;

        const request = context
            .switchToHttp()
            .getRequest<{ user?: UserDocument }>();
        const userId = request.user?._id?.toString();
        if (!userId) {
            // Guard поставили перед автентифікацією — це помилка конфігурації
            // роута, не користувача. Мовчазний `return true` перетворив би
            // оголошений ліміт на декорацію, тому падаємо голосно.
            throw new InternalServerErrorException({
                code: RESPONSE_CODE.INTERNAL_ERROR,
                message:
                    'UserRateLimitGuard requires an authenticated user; place it after JwtActiveGuard',
            });
        }

        const count = await this.redisCounter.incrementFixedWindow(
            `ratelimit:user:${options.bucket}:${userId}`,
            options.windowSec
        );
        if (count > options.limit) {
            throw new HttpException(
                {
                    code: RESPONSE_CODE.RATE_LIMIT_EXCEEDED,
                    message: 'Too many requests',
                },
                HttpStatus.TOO_MANY_REQUESTS
            );
        }
        return true;
    }
}
