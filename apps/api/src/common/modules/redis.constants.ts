/**
 * DI injection token for the shared ioredis client provided by RedisModule.
 *
 * Lives in its own file (not in redis.module.ts) so that consumers can import
 * it without pulling in the module class — this prevents circular imports
 * between RedisModule and services that the module itself provides
 * (e.g. RedisCounterService).
 */
export const REDIS_CLIENT = 'REDIS_CLIENT';
