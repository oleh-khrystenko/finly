import mongoose, { Types } from 'mongoose';

import { createReplSetMongo } from '../../src/test-utils/mongo';
import { runMigration } from './2026-08-16-orphan-businesses-cleanup';

/**
 * Ops-скрипт spec — разова чистка отримувачів після видалених акаунтів.
 *
 * Покриває:
 *  (а) показ нічого не змінює;
 *  (б) `--force` зносить сироту з усім піддеревом;
 *  (в) системний отримувач і запис з живим менеджером не чіпаються взагалі;
 *  (г) обірваний власник при живому менеджері нормалізується, а не видаляється;
 *  (д) повторний прогін після `--force` не знаходить нічого.
 *
 * Replica-set обов'язковий: каскад іде транзакцією (той самий інваріант, що у
 * кабінетному видаленні).
 */
describe('migration 2026-08-16-orphan-businesses-cleanup', () => {
    let mongo: Awaited<ReturnType<typeof createReplSetMongo>>;

    const liveUserId = new Types.ObjectId();
    const deadUserId = new Types.ObjectId();
    const secondDeadUserId = new Types.ObjectId();

    beforeAll(async () => {
        mongo = await createReplSetMongo();
        await mongoose.connect(mongo.uri);
    }, 60_000);

    afterAll(async () => {
        await mongoose.disconnect();
        await mongo.stop();
    });

    afterEach(async () => {
        const db = mongoose.connection.db!;
        const existing = await db
            .listCollections({}, { nameOnly: true })
            .toArray();
        for (const c of existing) {
            await db.collection(c.name).deleteMany({});
        }
    });

    const orphanId = new Types.ObjectId();
    const clientOfLiveBookkeeperId = new Types.ObjectId();
    const systemPayeeId = new Types.ObjectId();
    const brokenOwnerLiveManagerId = new Types.ObjectId();

    async function seed(): Promise<void> {
        const db = mongoose.connection.db!;
        await db.collection('users').insertOne({ _id: liveUserId });
        await db.collection('businesses').insertMany([
            {
                _id: orphanId,
                name: 'Сирота',
                slug: 'syrota',
                ownerId: deadUserId,
                managers: [],
            },
            {
                _id: clientOfLiveBookkeeperId,
                name: 'Клієнт бухгалтера',
                slug: 'klient',
                ownerId: null,
                managers: [liveUserId],
            },
            {
                _id: systemPayeeId,
                name: 'Податкова',
                slug: 'podatkova',
                ownerId: null,
                managers: [],
                isSystem: true,
            },
            {
                _id: brokenOwnerLiveManagerId,
                name: 'Обірваний власник',
                slug: 'obirvanyi',
                ownerId: deadUserId,
                managers: [liveUserId, secondDeadUserId],
            },
        ]);
        await db.collection('accounts').insertMany([
            { businessId: orphanId, iban: 'UA1' },
            { businessId: orphanId, iban: 'UA2' },
        ]);
        await db
            .collection('invoices')
            .insertOne({ businessId: orphanId, amount: 100 });
        await db
            .collection('businessslughistories')
            .insertOne({ businessId: orphanId, slugLower: 'stare' });
    }

    async function businessIds(): Promise<string[]> {
        const docs = await mongoose.connection
            .db!.collection('businesses')
            .find({}, { projection: { _id: 1 } })
            .toArray();
        return docs.map((d) => d._id.toString()).sort();
    }

    it('показ рахує сироту з піддеревом, але нічого не змінює', async () => {
        await seed();

        const result = await runMigration(mongoose.connection.db!);

        expect(result.force).toBe(false);
        expect(result.orphans).toEqual([
            expect.objectContaining({
                id: orphanId.toString(),
                accountsCount: 2,
                invoicesCount: 1,
                deleted: false,
            }),
        ]);
        expect(result.detachedOwners).toEqual([
            expect.objectContaining({
                id: brokenOwnerLiveManagerId.toString(),
                deadManagers: 1,
                updated: false,
            }),
        ]);
        expect(await businessIds()).toHaveLength(4);
    });

    it('--force зносить сироту з усім піддеревом і не чіпає решту', async () => {
        await seed();

        await runMigration(mongoose.connection.db!, { force: true });

        const db = mongoose.connection.db!;
        expect(await businessIds()).toEqual(
            [
                clientOfLiveBookkeeperId.toString(),
                systemPayeeId.toString(),
                brokenOwnerLiveManagerId.toString(),
            ].sort()
        );
        expect(await db.collection('accounts').countDocuments()).toBe(0);
        expect(await db.collection('invoices').countDocuments()).toBe(0);
        expect(
            await db.collection('businessslughistories').countDocuments()
        ).toBe(0);
    });

    it('--force нормалізує запис з обірваним власником, а не видаляє його', async () => {
        await seed();

        await runMigration(mongoose.connection.db!, { force: true });

        const doc = await mongoose.connection
            .db!.collection('businesses')
            .findOne({ _id: brokenOwnerLiveManagerId });
        expect(doc?.ownerId).toBeNull();
        expect(doc?.managers).toHaveLength(1);
        expect(doc?.managers?.[0]?.toString()).toBe(liveUserId.toString());
    });

    it('повторний прогін після --force не знаходить нічого', async () => {
        await seed();
        await runMigration(mongoose.connection.db!, { force: true });

        const second = await runMigration(mongoose.connection.db!, {
            force: true,
        });

        expect(second.orphans).toHaveLength(0);
        expect(second.detachedOwners).toHaveLength(0);
    });
});
