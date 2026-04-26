import {
    Global,
    Inject,
    Logger,
    Module,
    OnModuleDestroy,
    OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';

import { ENV } from '../../config/env';
import { RedisCounterService } from '../services/redis-counter.service';
import { REDIS_CLIENT } from './redis.constants';

export { REDIS_CLIENT };

const redisProvider = {
    provide: REDIS_CLIENT,
    useFactory: (): Redis => {
        const logger = new Logger('RedisProvider');
        const client = new Redis(ENV.REDIS_URL);

        client.on('error', (err: Error) => {
            logger.error(`Redis connection error: ${err.message}`);
        });

        client.on('connect', () => {
            logger.log('Redis connected');
        });

        return client;
    },
};

@Global()
@Module({
    providers: [redisProvider, RedisCounterService],
    exports: [REDIS_CLIENT, RedisCounterService],
})
export class RedisModule implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RedisModule.name);

    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

    async onModuleInit(): Promise<void> {
        const result = await this.redis.ping();
        this.logger.log(`Redis ping: ${result}`);
    }

    async onModuleDestroy(): Promise<void> {
        await this.redis.quit();
        this.logger.log('Redis connection closed');
    }
}
