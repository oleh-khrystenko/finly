import { Test, TestingModule } from '@nestjs/testing';

import { REDIS_CLIENT } from '../modules/redis.constants';
import { RedisCounterService } from './redis-counter.service';

describe('RedisCounterService', () => {
    let service: RedisCounterService;
    const mockRedis = {
        eval: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RedisCounterService,
                { provide: REDIS_CLIENT, useValue: mockRedis },
            ],
        }).compile();

        service = module.get<RedisCounterService>(RedisCounterService);
        jest.clearAllMocks();
    });

    describe('incrementFixedWindow', () => {
        it('should call eval with the fixed-window script and return the count', async () => {
            mockRedis.eval.mockResolvedValue(3);

            const result = await service.incrementFixedWindow('key:abc', 60);

            expect(result).toBe(3);
            expect(mockRedis.eval).toHaveBeenCalledTimes(1);
            const [script, numKeys, key, ttl] = mockRedis.eval.mock.calls[0];
            expect(numKeys).toBe(1);
            expect(key).toBe('key:abc');
            expect(ttl).toBe('60');
            // Fixed window: EXPIRE only on first INCR (when c == 1)
            expect(script).toContain('if c == 1 then');
            expect(script).toContain("redis.call('EXPIRE'");
        });

        it('should return 1 on first increment', async () => {
            mockRedis.eval.mockResolvedValue(1);
            await expect(
                service.incrementFixedWindow('new-key', 30)
            ).resolves.toBe(1);
        });

        it('should propagate Redis errors to the caller', async () => {
            mockRedis.eval.mockRejectedValue(new Error('Redis down'));
            await expect(
                service.incrementFixedWindow('key', 60)
            ).rejects.toThrow('Redis down');
        });
    });

    describe('incrementSlidingWindow', () => {
        it('should call eval with the sliding-window script and return the count', async () => {
            mockRedis.eval.mockResolvedValue(7);

            const result = await service.incrementSlidingWindow('lockout', 900);

            expect(result).toBe(7);
            expect(mockRedis.eval).toHaveBeenCalledTimes(1);
            const [script, numKeys, key, ttl] = mockRedis.eval.mock.calls[0];
            expect(numKeys).toBe(1);
            expect(key).toBe('lockout');
            expect(ttl).toBe('900');
            // Sliding window: EXPIRE on every call, no conditional
            expect(script).not.toContain('if c == 1');
            expect(script).toContain("redis.call('EXPIRE'");
        });

        it('should propagate Redis errors to the caller', async () => {
            mockRedis.eval.mockRejectedValue(new Error('connection lost'));
            await expect(
                service.incrementSlidingWindow('key', 60)
            ).rejects.toThrow('connection lost');
        });
    });

    describe('script semantics distinction', () => {
        it('should use a different script for each window mode', async () => {
            mockRedis.eval.mockResolvedValue(1);

            await service.incrementFixedWindow('a', 60);
            await service.incrementSlidingWindow('b', 60);

            const fixedScript = mockRedis.eval.mock.calls[0][0];
            const slidingScript = mockRedis.eval.mock.calls[1][0];

            expect(fixedScript).not.toBe(slidingScript);
        });
    });
});
