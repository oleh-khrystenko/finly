import { DEFAULT_CATALOG_CATEGORY } from '@finly/types';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import {
    ACCOUNTS_COLLECTION,
    BUSINESSES_COLLECTION,
    runMigration,
} from './2026-07-21-publicity-defaults';

/**
 * Migration spec — backfill прапорів каталогу і публічності (Sprint 29).
 *
 * Покриває:
 *  (а) pre-Sprint-29 документ отримує повний набір дефолтів;
 *  (б) наявні значення не перетираються (частково змігрований документ);
 *  (в) idempotent: повторний run — no-op і нульовий звіт.
 */

describe('migration 2026-07-21-publicity-defaults', () => {
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
        for (const name of [BUSINESSES_COLLECTION, ACCOUNTS_COLLECTION]) {
            const cols = await db.listCollections({ name }).toArray();
            if (cols.length > 0) {
                await db.collection(name).drop();
            }
        }
    });

    it('заповнює всі відсутні поля дефолтами', async () => {
        const db = mongoose.connection.db!;
        await db
            .collection(BUSINESSES_COLLECTION)
            .insertOne({ name: 'ФОП Петренко', slugLower: 'petrenko' });
        await db
            .collection(ACCOUNTS_COLLECTION)
            .insertOne({
                slugLower: 'main',
                iban: 'UA000000000000000000000000000',
            });

        const result = await runMigration(db);
        expect(result).toEqual({
            businessesBackfilled: 1,
            accountsBackfilled: 1,
        });

        const business = await db
            .collection(BUSINESSES_COLLECTION)
            .findOne({ slugLower: 'petrenko' });
        expect(business).toMatchObject({
            isSystem: false,
            catalogVisible: false,
            publicityStatus: 'none',
            publicityRequestedAt: null,
            publicityReviewedAt: null,
            publicityRejectionReason: null,
            catalogCategory: DEFAULT_CATALOG_CATEGORY,
        });

        const account = await db
            .collection(ACCOUNTS_COLLECTION)
            .findOne({ slugLower: 'main' });
        expect(account).toMatchObject({
            catalogVisible: false,
            paymentPurposeTemplate: null,
        });
    });

    it('не перетирає наявні значення', async () => {
        const db = mongoose.connection.db!;
        await db.collection(BUSINESSES_COLLECTION).insertOne({
            slugLower: 'dps',
            isSystem: true,
            catalogVisible: true,
            publicityStatus: 'approved',
        });

        await runMigration(db);

        const business = await db
            .collection(BUSINESSES_COLLECTION)
            .findOne({ slugLower: 'dps' });
        expect(business).toMatchObject({
            isSystem: true,
            catalogVisible: true,
            publicityStatus: 'approved',
            // Відсутні поля все одно долилися.
            publicityRejectionReason: null,
            catalogCategory: DEFAULT_CATALOG_CATEGORY,
        });
    });

    it('idempotent — повторний прогін нічого не звітує', async () => {
        const db = mongoose.connection.db!;
        await db
            .collection(BUSINESSES_COLLECTION)
            .insertOne({ slugLower: 'x' });

        await runMigration(db);
        expect(await runMigration(db)).toEqual({
            businessesBackfilled: 0,
            accountsBackfilled: 0,
        });
    });
});
