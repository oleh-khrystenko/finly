import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import {
    ACCOUNTS_COLLECTION,
    BUSINESSES_COLLECTION,
    INVOICES_COLLECTION,
    runMigration,
} from './2026-06-10-slug-customized-backfill';

/**
 * Migration spec — backfill `slugCustomized` для pre-Sprint-19 документів.
 *
 * Покриває:
 *  (а) business/account: 8-char tail → auto (false), інша форма → customized;
 *  (б) invoice: tail, `prefix-tail` (explicit/preset/with-purpose) → auto,
 *      ручна форма без tail-суфікса → customized;
 *  (в) документи з уже наявним полем (post-Sprint-19) не чіпаються;
 *  (г) idempotent: повторний run — no-op.
 */

describe('migration 2026-06-10-slug-customized-backfill', () => {
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
        for (const name of [
            BUSINESSES_COLLECTION,
            ACCOUNTS_COLLECTION,
            INVOICES_COLLECTION,
        ]) {
            const cols = await db.listCollections({ name }).toArray();
            if (cols.length > 0) {
                await db.collection(name).drop();
            }
        }
    });

    async function seed(
        collection: string,
        slug: string,
        extra: Record<string, unknown> = {}
    ): Promise<mongoose.Types.ObjectId> {
        const _id = new mongoose.Types.ObjectId();
        await mongoose.connection.db!.collection(collection).insertOne({
            _id,
            slug,
            slugLower: slug.toLowerCase(),
            createdAt: new Date(),
            updatedAt: new Date(),
            ...extra,
        });
        return _id;
    }

    async function flagOf(
        collection: string,
        id: mongoose.Types.ObjectId
    ): Promise<unknown> {
        const doc = await mongoose.connection
            .db!.collection(collection)
            .findOne({ _id: id });
        return doc?.slugCustomized;
    }

    it('business: 8-char tail → auto, vanity-форма → customized', async () => {
        const auto = await seed(BUSINESSES_COLLECTION, 'Xv0RTvfe');
        const vanity = await seed(BUSINESSES_COLLECTION, 'kvity-lviv');

        const result = await runMigration(mongoose.connection.db!);

        expect(result.businesses).toEqual({ customized: 1, auto: 1 });
        expect(await flagOf(BUSINESSES_COLLECTION, auto)).toBe(false);
        expect(await flagOf(BUSINESSES_COLLECTION, vanity)).toBe(true);
    });

    it('account: ті ж правила, що business', async () => {
        const auto = await seed(ACCOUNTS_COLLECTION, 'aB3dE9xZ');
        const vanity = await seed(ACCOUNTS_COLLECTION, 'privat-osnovnyi');

        const result = await runMigration(mongoose.connection.db!);

        expect(result.accounts).toEqual({ customized: 1, auto: 1 });
        expect(await flagOf(ACCOUNTS_COLLECTION, auto)).toBe(false);
        expect(await flagOf(ACCOUNTS_COLLECTION, vanity)).toBe(true);
    });

    it('invoice: усі форми генератора → auto, ручний rename → customized', async () => {
        const random = await seed(INVOICES_COLLECTION, 'q1W2e3R4');
        const preset = await seed(INVOICES_COLLECTION, 'inv-001-aB3dE9xZ');
        const monthly = await seed(INVOICES_COLLECTION, '2026-05-012-q1W2e3R4');
        const explicit = await seed(
            INVOICES_COLLECTION,
            'oplata-poslug-Zx9yW8vU'
        );
        const vanity = await seed(INVOICES_COLLECTION, 'oplata-konsultacii');

        const result = await runMigration(mongoose.connection.db!);

        expect(result.invoices).toEqual({ customized: 1, auto: 4 });
        expect(await flagOf(INVOICES_COLLECTION, random)).toBe(false);
        expect(await flagOf(INVOICES_COLLECTION, preset)).toBe(false);
        expect(await flagOf(INVOICES_COLLECTION, monthly)).toBe(false);
        expect(await flagOf(INVOICES_COLLECTION, explicit)).toBe(false);
        expect(await flagOf(INVOICES_COLLECTION, vanity)).toBe(true);
    });

    it('документи з наявним полем (post-Sprint-19) не чіпаються', async () => {
        // Vanity-форма, але explicit false (наприклад, reset уже після
        // Sprint 19) — backfill не сміє перезаписати runtime-значення.
        const id = await seed(BUSINESSES_COLLECTION, 'kvity-lviv', {
            slugCustomized: false,
        });

        const result = await runMigration(mongoose.connection.db!);

        expect(result.businesses).toEqual({ customized: 0, auto: 0 });
        expect(await flagOf(BUSINESSES_COLLECTION, id)).toBe(false);
    });

    it('idempotent: повторний run — no-op', async () => {
        await seed(BUSINESSES_COLLECTION, 'kvity-lviv');
        await seed(INVOICES_COLLECTION, 'q1W2e3R4');

        await runMigration(mongoose.connection.db!);
        const second = await runMigration(mongoose.connection.db!);

        expect(second).toEqual({
            businesses: { customized: 0, auto: 0 },
            accounts: { customized: 0, auto: 0 },
            invoices: { customized: 0, auto: 0 },
        });
    });
});
