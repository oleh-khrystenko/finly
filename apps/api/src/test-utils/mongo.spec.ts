import mongoose, { Schema } from 'mongoose';

import { createReplSetMongo } from './mongo';

/**
 * Sprint 4 §4.0 smoke — verify, що `createReplSetMongo` справді стартує
 * replica-set і `session.withTransaction` працює end-to-end. Без цього
 * smoke-у регресія "тест-suite на standalone mongod" пройде до момента
 * fail-у конкретного cascade-delete-spec-у — занадто пізно.
 *
 * Не тестуємо `createStandaloneMongo` — він тривіальний proxy на
 * `MongoMemoryServer.create()`, що вже покрите десятками існуючих spec-ів.
 */
describe('createReplSetMongo (Sprint 4 §4.0)', () => {
    let mongo: Awaited<ReturnType<typeof createReplSetMongo>>;
    let connection: mongoose.Connection;

    beforeAll(async () => {
        mongo = await createReplSetMongo();
        connection = (await mongoose
            .createConnection(mongo.uri)
            .asPromise()) as unknown as mongoose.Connection;
    }, 30_000);

    afterAll(async () => {
        await connection.close();
        await mongo.stop();
    });

    it('exposes a uri with replicaSet query-param', () => {
        expect(mongo.uri).toMatch(/replicaSet=/);
    });

    it('supports session.withTransaction with multi-document atomicity', async () => {
        interface Counter {
            _id: string;
            value: number;
        }
        const CounterSchema = new Schema<Counter>(
            { _id: String, value: Number },
            { versionKey: false }
        );
        const CounterModel = connection.model<Counter>(
            'Counter',
            CounterSchema
        );
        const LogSchema = new Schema<{ msg: string }>(
            { msg: String },
            { versionKey: false }
        );
        const LogModel = connection.model('Log', LogSchema);

        // Happy path — transaction коммітиться, обидва writes видно.
        const session = await connection.startSession();
        try {
            await session.withTransaction(async () => {
                await CounterModel.create([{ _id: 'a', value: 1 }], {
                    session,
                });
                await LogModel.create([{ msg: 'committed' }], { session });
            });
        } finally {
            await session.endSession();
        }
        expect(await CounterModel.findById('a')).toMatchObject({ value: 1 });
        expect(await LogModel.countDocuments({ msg: 'committed' })).toBe(1);

        // Rollback path — throw всередині транзакції відкочує обидва writes.
        const rollbackSession = await connection.startSession();
        await expect(
            rollbackSession.withTransaction(async () => {
                await CounterModel.create([{ _id: 'b', value: 2 }], {
                    session: rollbackSession,
                });
                await LogModel.create([{ msg: 'will-rollback' }], {
                    session: rollbackSession,
                });
                throw new Error('intentional rollback');
            })
        ).rejects.toThrow('intentional rollback');
        await rollbackSession.endSession();

        expect(await CounterModel.findById('b')).toBeNull();
        expect(await LogModel.countDocuments({ msg: 'will-rollback' })).toBe(0);
    }, 30_000);
});
