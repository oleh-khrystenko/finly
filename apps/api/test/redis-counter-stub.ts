import type { RedisCounterService } from '../src/common/services/redis-counter.service';

/**
 * In-memory заміна `RedisCounterService` для e2e (fake-Redis у тестах не має
 * `eval`, на якому тримаються Lua-лічильники).
 *
 * Рахує по-справжньому, а не повертає константу: `UserRateLimitGuard` стоїть на
 * реальних роутах, тож тест ліміту мусить мати змогу довести лічильник до порога.
 * TTL ігноруємо — жоден e2e не чекає спливу вікна.
 *
 * Імена методів навмисно дзеркалять реальний сервіс: попередній stub оголошував
 * `incrementFixed`/`incrementSliding`, і будь-який справжній виклик падав би
 * `TypeError` замість роботи ліміту.
 */
export function createCounterStub(): Pick<
    RedisCounterService,
    'incrementFixedWindow' | 'incrementSlidingWindow'
> {
    const counters = new Map<string, number>();
    const bump = (key: string): number => {
        const next = (counters.get(key) ?? 0) + 1;
        counters.set(key, next);
        return next;
    };
    return {
        incrementFixedWindow: (key: string) => Promise.resolve(bump(key)),
        incrementSlidingWindow: (key: string) => Promise.resolve(bump(key)),
    };
}
