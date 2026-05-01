import {
    ExecutionContext,
    HttpException,
    HttpStatus,
    InternalServerErrorException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { RESPONSE_CODE } from '@finly/types';

import { RedisCounterService } from '../../../common/services/redis-counter.service';
import { AiRateLimitGuard } from './ai-rate-limit.guard';

jest.mock('../../../config/env', () => ({
    ENV: {
        AI_CHAT_IP_LIMIT: 20,
    },
}));

const mockRedisCounter = {
    incrementFixedWindow: jest.fn(),
    incrementSlidingWindow: jest.fn(),
};

const buildContext = (request: Partial<Request> = {}): ExecutionContext => {
    const fullRequest = {
        user: {},
        ip: '127.0.0.1',
        headers: {},
        ...request,
    };
    return {
        switchToHttp: () => ({
            getRequest: () => fullRequest,
        }),
    } as unknown as ExecutionContext;
};

describe('AiRateLimitGuard', () => {
    let guard: AiRateLimitGuard;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AiRateLimitGuard,
                { provide: RedisCounterService, useValue: mockRedisCounter },
            ],
        }).compile();

        guard = module.get<AiRateLimitGuard>(AiRateLimitGuard);
        jest.clearAllMocks();
        mockRedisCounter.incrementFixedWindow.mockResolvedValue(1);
    });

    describe('checkIpLimit', () => {
        it('should call incrementFixedWindow with correct key and 24h TTL', async () => {
            const ctx = buildContext({ ip: '203.0.113.7' });

            await guard.canActivate(ctx);

            expect(mockRedisCounter.incrementFixedWindow).toHaveBeenCalledWith(
                'ai:ip:203.0.113.7',
                86400
            );
        });

        it('should prefer x-forwarded-for over request.ip', async () => {
            const ctx = buildContext({
                ip: '127.0.0.1',
                headers: { 'x-forwarded-for': '198.51.100.42' },
            });

            await guard.canActivate(ctx);

            expect(mockRedisCounter.incrementFixedWindow).toHaveBeenCalledWith(
                'ai:ip:198.51.100.42',
                86400
            );
        });

        it('should pick the first IP when x-forwarded-for is a comma list', async () => {
            const ctx = buildContext({
                headers: {
                    'x-forwarded-for': '198.51.100.42, 10.0.0.1, 10.0.0.2',
                },
            });

            await guard.canActivate(ctx);

            expect(mockRedisCounter.incrementFixedWindow).toHaveBeenCalledWith(
                'ai:ip:198.51.100.42',
                86400
            );
        });

        it('should fall back to "unknown" when no IP info is available', async () => {
            const ctx = buildContext({
                ip: undefined,
                headers: {},
            });

            await guard.canActivate(ctx);

            expect(mockRedisCounter.incrementFixedWindow).toHaveBeenCalledWith(
                'ai:ip:unknown',
                86400
            );
        });

        it('should pass when count is at the limit (20th request)', async () => {
            mockRedisCounter.incrementFixedWindow.mockResolvedValue(20);
            const ctx = buildContext();

            await expect(guard.canActivate(ctx)).resolves.toBe(true);
        });

        it('should throw 429 with AI_RATE_LIMIT_EXCEEDED on the 21st request', async () => {
            mockRedisCounter.incrementFixedWindow.mockResolvedValue(21);
            const ctx = buildContext();

            const error = await guard.canActivate(ctx).catch((e: unknown) => e);

            expect(error).toBeInstanceOf(HttpException);
            expect((error as HttpException).getStatus()).toBe(
                HttpStatus.TOO_MANY_REQUESTS
            );
            expect((error as HttpException).getResponse()).toMatchObject({
                code: RESPONSE_CODE.AI_RATE_LIMIT_EXCEEDED,
            });
        });

        it('should wrap Redis errors in InternalServerErrorException', async () => {
            mockRedisCounter.incrementFixedWindow.mockRejectedValue(
                new Error('Redis connection lost')
            );
            const ctx = buildContext();

            await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
                InternalServerErrorException
            );
        });

        it('should NOT wrap HttpException from limit check (passes through as 429)', async () => {
            mockRedisCounter.incrementFixedWindow.mockResolvedValue(99);
            const ctx = buildContext();

            const error = await guard.canActivate(ctx).catch((e: unknown) => e);

            expect(error).toBeInstanceOf(HttpException);
            expect(error).not.toBeInstanceOf(InternalServerErrorException);
            expect((error as HttpException).getStatus()).toBe(
                HttpStatus.TOO_MANY_REQUESTS
            );
        });
    });
});
