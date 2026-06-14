import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import Redis from 'ioredis';

import { REDIS_CLIENT } from '../modules/redis.constants';

// Звільнення локу — compare-and-delete: знімаємо лише власний токен, інакше
// операція, що перевищила TTL, видалила б lock, уже захоплений іншим запитом.
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
`;

/**
 * Лок зайнятий іншим холдером. Не помилка виконання — сигнал для caller-а
 * вирішити: bounded-retry чи мапінг у доменний 409.
 */
export class RedisLockBusyError extends Error {
    constructor(key: string) {
        super(`Redis lock busy: ${key}`);
        this.name = 'RedisLockBusyError';
    }
}

/**
 * Generic per-key мьютекс на Redis `SET NX PX`: серіалізує критичні секції, де
 * read-then-write над БД не закривається unique-індексом (наприклад, count-based
 * ліміти створення бізнесів). TTL — fallback на крах процесу всередині секції;
 * звільнення гарантоване `finally` + compare-and-delete власного токена.
 */
@Injectable()
export class RedisLockService {
    private readonly logger = new Logger(RedisLockService.name);

    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

    async withLock<T>(
        key: string,
        ttlMs: number,
        fn: () => Promise<T>
    ): Promise<T> {
        const token = randomBytes(16).toString('hex');
        const acquired = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
        if (acquired !== 'OK') {
            throw new RedisLockBusyError(key);
        }
        try {
            return await fn();
        } finally {
            try {
                await this.redis.eval(RELEASE_SCRIPT, 1, key, token);
            } catch (error) {
                this.logger.error(
                    `Failed to release lock ${key} (expires in ≤${ttlMs}ms)`,
                    error instanceof Error ? error.stack : String(error)
                );
            }
        }
    }
}
