import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import {
    LEGACY_COLLECTIONS,
    runMigration,
} from './2026-07-17-drop-legacy-collections';

/**
 * Ops-скрипт spec — дроп 4 legacy-колекцій.
 *
 * Покриває:
 *  (а) dry-run рахує документи, але НІЧОГО не видаляє;
 *  (б) --force дропає всі колекції з білого списку;
 *  (в) стороння колекція (не в списку) лишається недоторканою;
 *  (г) idempotent: колекції, якої немає, тихо пропускаємо (existed:false).
 */

const KEEP_COLLECTION = 'users';

describe('migration 2026-07-17-drop-legacy-collections', () => {
    let mongoServer: MongoMemoryServer;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        await mongoose.connect(mongoServer.getUri());
    }, 60_000);

    afterAll(async () => {
        await mongoose.disconnect();
        await mongoServer.stop();
    });

    afterEach(async () => {
        const db = mongoose.connection.db!;
        const existing = await db.listCollections({}, { nameOnly: true }).toArray();
        for (const c of existing) {
            await db.collection(c.name).drop();
        }
    });

    async function seedLegacyWithDocs(): Promise<void> {
        const db = mongoose.connection.db!;
        for (const name of LEGACY_COLLECTIONS) {
            await db.collection(name).insertOne({ marker: name });
        }
    }

    async function collectionNames(): Promise<string[]> {
        const cols = await mongoose.connection
            .db!.listCollections({}, { nameOnly: true })
            .toArray();
        return cols.map((c) => c.name).sort();
    }

    it('dry-run рахує, але нічого не видаляє', async () => {
        await seedLegacyWithDocs();

        const result = await runMigration(mongoose.connection.db!);

        expect(result.force).toBe(false);
        for (const o of result.outcomes) {
            expect(o.existed).toBe(true);
            expect(o.count).toBe(1);
            expect(o.dropped).toBe(false);
        }
        // Усі колекції на місці.
        expect(await collectionNames()).toEqual([...LEGACY_COLLECTIONS].sort());
    });

    it('--force дропає всі колекції з білого списку', async () => {
        await seedLegacyWithDocs();

        const result = await runMigration(mongoose.connection.db!, {
            force: true,
        });

        expect(result.force).toBe(true);
        expect(result.outcomes.every((o) => o.dropped)).toBe(true);
        expect(await collectionNames()).toEqual([]);
    });

    it('стороння колекція (не в списку) лишається недоторканою', async () => {
        await seedLegacyWithDocs();
        await mongoose.connection
            .db!.collection(KEEP_COLLECTION)
            .insertOne({ email: 'keep@finly.test' });

        await runMigration(mongoose.connection.db!, { force: true });

        expect(await collectionNames()).toEqual([KEEP_COLLECTION]);
        expect(
            await mongoose.connection
                .db!.collection(KEEP_COLLECTION)
                .countDocuments()
        ).toBe(1);
    });

    it('idempotent: відсутню колекцію тихо пропускаємо', async () => {
        // Нічого не сіємо — жодної legacy-колекції немає.
        const result = await runMigration(mongoose.connection.db!, {
            force: true,
        });

        expect(result.outcomes.every((o) => !o.existed)).toBe(true);
        expect(result.outcomes.every((o) => !o.dropped)).toBe(true);
        expect(result.outcomes.every((o) => o.count === 0)).toBe(true);
    });
});
