import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import {
    BUSINESSES_COLLECTION,
    runMigration,
} from './2026-06-18-businesses-brand-null';

/**
 * Migration spec — backfill `brand: null` для pre-Sprint-21 бізнесів.
 *
 * Покриває:
 *  (а) документ без поля → отримує явний null;
 *  (б) документ з уже наявним `brand` (post-Sprint-21) не чіпається;
 *  (в) idempotent: повторний run — no-op.
 */

describe('migration 2026-06-18-businesses-brand-null', () => {
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
            .listCollections({ name: BUSINESSES_COLLECTION })
            .toArray();
        if (cols.length > 0) {
            await db.collection(BUSINESSES_COLLECTION).drop();
        }
    });

    async function seed(
        extra: Record<string, unknown> = {}
    ): Promise<mongoose.Types.ObjectId> {
        const _id = new mongoose.Types.ObjectId();
        await mongoose.connection
            .db!.collection(BUSINESSES_COLLECTION)
            .insertOne({
                _id,
                slug: 'kvity-lviv',
                slugLower: 'kvity-lviv',
                createdAt: new Date(),
                updatedAt: new Date(),
                ...extra,
            });
        return _id;
    }

    async function brandOf(id: mongoose.Types.ObjectId): Promise<unknown> {
        const doc = await mongoose.connection
            .db!.collection(BUSINESSES_COLLECTION)
            .findOne({ _id: id });
        return doc?.brand;
    }

    it('документ без поля отримує явний null', async () => {
        const legacy = await seed();

        const result = await runMigration(mongoose.connection.db!);

        expect(result).toEqual({ backfilled: 1 });
        expect(await brandOf(legacy)).toBeNull();
    });

    it('документ з наявним brand не чіпається', async () => {
        const active = {
            active: {
                logoUrl: 'https://cdn.finly.test/brand-logos/x/a.webp',
                centerMarkUrl: 'https://cdn.finly.test/brand-logos/x/c.png',
                bandMarkUrl: 'https://cdn.finly.test/brand-logos/x/b.png',
                displayName: 'Квіти',
            },
            pending: null,
        };
        const id = await seed({ brand: active });

        const result = await runMigration(mongoose.connection.db!);

        expect(result).toEqual({ backfilled: 0 });
        expect(await brandOf(id)).toEqual(active);
    });

    it('idempotent: повторний run — no-op', async () => {
        await seed();

        await runMigration(mongoose.connection.db!);
        const second = await runMigration(mongoose.connection.db!);

        expect(second).toEqual({ backfilled: 0 });
    });
});
