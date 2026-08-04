import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import {
    USERS_COLLECTION,
    runMigration,
} from './2026-07-30-drop-user-tax-profile';

/**
 * Migration spec — знесення власного РНОКПП з профілю.
 *
 * Покриває:
 *  (а) номер і стемп відмови зникають, решта профілю ціла;
 *  (б) користувач без цих полів не чіпається;
 *  (в) idempotent: повторний run — нульовий звіт.
 */

describe('migration 2026-07-30-drop-user-tax-profile', () => {
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
            .listCollections({ name: USERS_COLLECTION })
            .toArray();
        if (cols.length > 0) {
            await db.collection(USERS_COLLECTION).drop();
        }
    });

    it('прибирає номер і стемп, не чіпаючи решту профілю', async () => {
        const db = mongoose.connection.db!;
        await db.collection(USERS_COLLECTION).insertOne({
            email: 'buh@finly.com.ua',
            profile: {
                firstName: 'Олена',
                lastName: 'Ковальчук',
                middleName: 'Петрівна',
                taxId: '3182710695',
            },
            taxProfilePromptDismissedAt: new Date(),
        });

        expect(await runMigration(db)).toEqual({
            taxIdsRemoved: 1,
            promptStampsRemoved: 1,
        });

        const user = await db
            .collection(USERS_COLLECTION)
            .findOne({ email: 'buh@finly.com.ua' });
        expect(user!.profile).toEqual({
            firstName: 'Олена',
            lastName: 'Ковальчук',
            middleName: 'Петрівна',
        });
        expect(user).not.toHaveProperty('taxProfilePromptDismissedAt');
    });

    it('користувача без цих полів не рахує', async () => {
        const db = mongoose.connection.db!;
        await db.collection(USERS_COLLECTION).insertOne({
            email: 'fop@finly.com.ua',
            profile: { firstName: 'Іван', lastName: 'Іваненко' },
        });

        expect(await runMigration(db)).toEqual({
            taxIdsRemoved: 0,
            promptStampsRemoved: 0,
        });
    });

    it('idempotent — повторний прогін нічого не звітує', async () => {
        const db = mongoose.connection.db!;
        await db.collection(USERS_COLLECTION).insertOne({
            email: 'again@finly.com.ua',
            profile: { taxId: '3182710695' },
            taxProfilePromptDismissedAt: null,
        });

        await runMigration(db);
        expect(await runMigration(db)).toEqual({
            taxIdsRemoved: 0,
            promptStampsRemoved: 0,
        });
    });
});
