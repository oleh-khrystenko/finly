import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import {
    COLLECTION_NAME,
    expectedAutoName,
    runMigration,
} from './2026-06-02-accounts-null-auto-name';

/**
 * Migration spec — занулення матеріалізованої авто-назви рахунку.
 *
 * Покриває:
 *  (а) auto-name з розпізнаним банком → null;
 *  (б) auto-name з null-банком ("Банк •last4") → null;
 *  (в) користувацька назва — preserved;
 *  (г) idempotent: повторний run — no-op (нема рядкових авто-назв);
 *  (д) кілька документів за один bulkWrite.
 */

const businessId = new mongoose.Types.ObjectId();

describe('migration 2026-06-02-accounts-null-auto-name', () => {
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
        const cols = await db
            .listCollections({ name: COLLECTION_NAME })
            .toArray();
        if (cols.length > 0) {
            await db.collection(COLLECTION_NAME).drop();
        }
    });

    async function seedAccount(overrides: Record<string, unknown> = {}) {
        const db = mongoose.connection.db!;
        const doc = {
            _id: new mongoose.Types.ObjectId(),
            businessId,
            iban: 'UA273052992990004149497786452',
            bankCode: 'privatbank',
            name: 'ПриватБанк •6452',
            slug: 'AbCd1234',
            invoiceSlugPresetDefault: null,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...overrides,
        };
        await db.collection(COLLECTION_NAME).insertOne(doc);
        return doc._id;
    }

    it('auto-name з розпізнаним банком → null', async () => {
        const id = await seedAccount();

        const result = await runMigration(mongoose.connection.db!);
        expect(result.nulled).toBe(1);

        const updated = await mongoose.connection
            .db!.collection(COLLECTION_NAME)
            .findOne({ _id: id });
        expect(updated?.name).toBeNull();
    });

    it('auto-name з null-банком ("Банк •last4") → null', async () => {
        const iban = 'UA213223130000026007233566001';
        const id = await seedAccount({
            iban,
            bankCode: null,
            name: expectedAutoName(null, iban),
        });

        const result = await runMigration(mongoose.connection.db!);
        expect(result.nulled).toBe(1);

        const updated = await mongoose.connection
            .db!.collection(COLLECTION_NAME)
            .findOne({ _id: id });
        expect(updated?.name).toBeNull();
    });

    it('користувацька назва — preserved', async () => {
        const id = await seedAccount({ name: 'Основний рахунок' });

        const result = await runMigration(mongoose.connection.db!);
        expect(result.nulled).toBe(0);

        const updated = await mongoose.connection
            .db!.collection(COLLECTION_NAME)
            .findOne({ _id: id });
        expect(updated?.name).toBe('Основний рахунок');
    });

    it('idempotent: повторний run — no-op', async () => {
        await seedAccount();

        await runMigration(mongoose.connection.db!);
        const second = await runMigration(mongoose.connection.db!);

        expect(second.scanned).toBe(0);
        expect(second.nulled).toBe(0);
    });

    it('кілька документів — усі занулюються за один прохід', async () => {
        await seedAccount({ slug: 'Acc00001' });
        await seedAccount({
            _id: new mongoose.Types.ObjectId(),
            slug: 'Acc00002',
            name: 'Власна назва',
        });
        await seedAccount({
            _id: new mongoose.Types.ObjectId(),
            slug: 'Acc00003',
        });

        const result = await runMigration(mongoose.connection.db!);
        expect(result.scanned).toBe(3);
        expect(result.nulled).toBe(2);

        const all = await mongoose.connection
            .db!.collection(COLLECTION_NAME)
            .find({})
            .toArray();
        const preserved = all.find((d) => d.name === 'Власна назва');
        expect(preserved).toBeDefined();
        expect(all.filter((d) => d.name === null)).toHaveLength(2);
    });
});
