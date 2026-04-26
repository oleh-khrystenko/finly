import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';

import { REDIS_CLIENT } from '../modules/redis.constants';

/**
 * Atomic counter primitives backed by Redis Lua scripts.
 *
 * The naive pattern `INCR key; EXPIRE key ttl` (whether issued as two separate
 * commands or as a Redis pipeline) is NOT atomic from the perspective of process
 * crashes: if the process dies, the connection drops, or the event loop stalls
 * between the two commands, the counter ends up without a TTL and is retained
 * forever. For lockout/rate-limit counters that translates into permanent denial
 * of service for legitimate users.
 *
 * Lua scripts execute as a single atomic unit on the Redis server, so the INCR
 * and EXPIRE either both apply or neither does, regardless of what happens on
 * the application side after the call is dispatched.
 */
@Injectable()
export class RedisCounterService {
    /**
     * Fixed-window counter: TTL is set only on the first increment (when the
     * counter is created). Subsequent increments do NOT touch the TTL, so the
     * counter expires `ttlSeconds` after the first hit regardless of how many
     * more hits arrive in between.
     *
     * Use for "at most N requests per fixed window starting from first request"
     * semantics — e.g. magic link send rate limit, AI chat IP rate limit.
     */
    private static readonly FIXED_WINDOW_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return c
`;

    /**
     * Sliding-window counter: TTL is refreshed on every increment, so the
     * counter only expires after `ttlSeconds` of inactivity. Continuous activity
     * keeps the counter (and any lockout it represents) alive indefinitely.
     *
     * Use for lockout counters where ongoing abuse must keep the offender locked
     * — e.g. brute-force login attempts, check-email probing.
     */
    private static readonly SLIDING_WINDOW_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[1])
return c
`;

    constructor(
        @Inject(REDIS_CLIENT)
        private readonly redis: Redis
    ) {}

    /**
     * Atomically increments `key` and, on first creation, sets `ttlSeconds` TTL.
     *
     * @returns the counter value after increment
     */
    async incrementFixedWindow(
        key: string,
        ttlSeconds: number
    ): Promise<number> {
        return this.evalCounter(
            RedisCounterService.FIXED_WINDOW_SCRIPT,
            key,
            ttlSeconds
        );
    }

    /**
     * Atomically increments `key` and refreshes its TTL to `ttlSeconds` on
     * every call (sliding window).
     *
     * @returns the counter value after increment
     */
    async incrementSlidingWindow(
        key: string,
        ttlSeconds: number
    ): Promise<number> {
        return this.evalCounter(
            RedisCounterService.SLIDING_WINDOW_SCRIPT,
            key,
            ttlSeconds
        );
    }

    private async evalCounter(
        script: string,
        key: string,
        ttlSeconds: number
    ): Promise<number> {
        // Lua INCR always returns an integer; cast is safe by script contract.
        const result = await this.redis.eval(
            script,
            1,
            key,
            ttlSeconds.toString()
        );
        return result as number;
    }
}
