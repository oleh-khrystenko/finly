import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';

/**
 * Sprint 4 §4.0 — два варіанти in-memory Mongo для test-suite.
 *
 * **`createStandaloneMongo`** — single-node mongod без replica-set. Найшвидший
 * варіант старту (~1.5–2s), достатній для більшості CRUD/schema/guard тестів.
 * Sprint-1..3 тести користуються ним напряму через `MongoMemoryServer.create()`
 * — цей helper лише централізує контракт для нових тестів і дає симетричний
 * shape з replica-set варіантом.
 *
 * **`createReplSetMongo`** — replica-set (1 member). Обовʼязковий для тестів,
 * що використовують Mongo transactions (`session.withTransaction`) — Sprint 4
 * §4.2 cascade-delete (рішення SP-5: atomic-or-nothing). Старт повільніший
 * (~3–5s), бо driver чекає на election. Тести opt-in через імпорт саме цієї
 * фабрики; глобального swap-у не робимо — зайве сповільнення для тестів,
 * де replica-set не потрібен.
 *
 * **Контракт обох фабрик ідентичний:** повертають `{ uri, stop }`. Caller
 * передає `uri` у `MongooseModule.forRoot` (e2e) або `mongoose.connect`
 * (schema-spec); викликає `stop()` у `afterAll` для cleanup.
 *
 * **Чому окремий module замість inline у кожному spec.** DRY + single point
 * для майбутнього "tweak ReplSet config" (зокрема `replSet.count`, `oplogSize`).
 * Якщо потрібно буде перейти на 3-member replica-set для тестів конкуренції
 * — змінюємо одне місце, не 20 spec-файлів.
 */

export interface InMemoryMongo {
    uri: string;
    stop: () => Promise<void>;
}

export async function createStandaloneMongo(): Promise<InMemoryMongo> {
    const server = await MongoMemoryServer.create();
    return {
        uri: server.getUri(),
        stop: async () => {
            await server.stop();
        },
    };
}

export async function createReplSetMongo(): Promise<InMemoryMongo> {
    const replSet = await MongoMemoryReplSet.create({
        // 1 member — мінімум для transactions. Election тривіальний,
        // primary стає миттєво. Більше не потрібно: тести не валідують
        // multi-node failover.
        replSet: { count: 1 },
    });
    // `getUri()` повертає URI з `replicaSet=...` query-param — Mongoose
    // driver автоматично активує SDAM і transactions працюють out-of-the-box.
    return {
        uri: replSet.getUri(),
        stop: async () => {
            await replSet.stop();
        },
    };
}
