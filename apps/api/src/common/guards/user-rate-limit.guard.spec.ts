import {
    ExecutionContext,
    HttpStatus,
    InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { UserRateLimitGuard } from './user-rate-limit.guard';
import type { UserRateLimitOptions } from '../decorators/user-rate-limit.decorator';
import type { RedisCounterService } from '../services/redis-counter.service';

const OPTIONS: UserRateLimitOptions = {
    bucket: 'slug-availability',
    limit: 2,
    windowSec: 60,
};

const buildContext = (userId: string | undefined): ExecutionContext =>
    ({
        getHandler: () => () => undefined,
        getClass: () => class {},
        switchToHttp: () => ({
            getRequest: () => ({
                user: userId ? { _id: { toString: () => userId } } : undefined,
            }),
        }),
    }) as unknown as ExecutionContext;

describe('UserRateLimitGuard', () => {
    const counter = { incrementFixedWindow: jest.fn() };
    const reflector = { getAllAndOverride: jest.fn() };
    const guard = new UserRateLimitGuard(
        reflector as unknown as Reflector,
        counter as unknown as RedisCounterService
    );

    beforeEach(() => {
        jest.clearAllMocks();
        reflector.getAllAndOverride.mockReturnValue(OPTIONS);
        counter.incrementFixedWindow.mockResolvedValue(1);
    });

    it('рахує ліміт по userId, а не по IP', async () => {
        await guard.canActivate(buildContext('user-1'));

        expect(counter.incrementFixedWindow).toHaveBeenCalledWith(
            'ratelimit:user:slug-availability:user-1',
            60
        );
    });

    it('пропускає запит у межах ліміту', async () => {
        counter.incrementFixedWindow.mockResolvedValue(2);

        await expect(guard.canActivate(buildContext('user-1'))).resolves.toBe(
            true
        );
    });

    it('кидає 429 понад ліміт', async () => {
        counter.incrementFixedWindow.mockResolvedValue(3);

        await expect(
            guard.canActivate(buildContext('user-1'))
        ).rejects.toMatchObject({
            status: HttpStatus.TOO_MANY_REQUESTS,
            response: { code: 'RATE_LIMIT_EXCEEDED' },
        });
    });

    it('без оголошеного ліміту нічого не рахує', async () => {
        reflector.getAllAndOverride.mockReturnValue(undefined);

        await expect(guard.canActivate(buildContext('user-1'))).resolves.toBe(
            true
        );
        expect(counter.incrementFixedWindow).not.toHaveBeenCalled();
    });

    /**
     * Guard перед автентифікацією — помилка конфігурації роута. Тихий пропуск
     * перетворив би оголошений ліміт на декорацію, тож падаємо голосно.
     */
    it('падає, якщо користувача у запиті немає', async () => {
        await expect(
            guard.canActivate(buildContext(undefined))
        ).rejects.toBeInstanceOf(InternalServerErrorException);
        expect(counter.incrementFixedWindow).not.toHaveBeenCalled();
    });
});
