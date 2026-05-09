import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import {
    BUSINESSES_COLLECTION,
    INVOICES_COLLECTION,
    runMigration,
} from './2026-05-08-invoices-payee-snapshot';

/**
 * Sprint 4 review fix migration spec — backfill `payeeSnapshot` для existing
 * invoices з current business state.
 *
 * Покриває:
 *  (а) snapshot заповнюється з business.name + requisites + paymentPurposeTemplate;
 *  (б) `paymentPurpose: null` (inheritance) → resolve через template;
 *  (в) `paymentPurpose != null` (user-set) → preserved у snapshot;
 *  (г) idempotent: повторний run — no-op для already-snapshotted invoices;
 *  (д) doc з `payeeSnapshot: null` (explicitly null) — теж backfill-иться
 *      (`$or`-filter ловить null + missing field).
 */

const businessId = new mongoose.Types.ObjectId();

describe('migration 2026-05-08-invoices-payee-snapshot', () => {
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
        for (const name of [INVOICES_COLLECTION, BUSINESSES_COLLECTION]) {
            const cols = await db.listCollections({ name }).toArray();
            if (cols.length > 0) {
                await db.collection(name).drop();
            }
        }
    });

    async function seedBusiness(overrides: Record<string, unknown> = {}) {
        const db = mongoose.connection.db!;
        await db.collection(BUSINESSES_COLLECTION).insertOne({
            _id: businessId,
            type: 'fop',
            name: 'ФОП Іваненко',
            requisites: {
                iban: 'UA213223130000026007233566001',
                taxId: '1234567899',
            },
            paymentPurposeTemplate: 'Оплата за послуги',
            acceptedBanks: ['privatbank'],
            slug: 'IvanEnko',
            slugLower: 'ivanenko',
            ownerId: new mongoose.Types.ObjectId(),
            managers: [],
            ...overrides,
        });
    }

    async function seedInvoice(overrides: Record<string, unknown> = {}) {
        const db = mongoose.connection.db!;
        const doc = {
            _id: new mongoose.Types.ObjectId(),
            businessId,
            slug: 'inv-001-aaaaaaaa',
            amount: 150000,
            amountLocked: true,
            paymentPurpose: 'Custom',
            validUntil: null,
            slugPreset: 'simple',
            slugCounterScope: 'simple',
            slugCounter: 1,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...overrides,
        };
        await db.collection(INVOICES_COLLECTION).insertOne(doc);
        return doc._id;
    }

    it('backfill snapshot з business для invoice з user-set paymentPurpose', async () => {
        await seedBusiness();
        const id = await seedInvoice({ paymentPurpose: 'Custom invoice' });

        const result = await runMigration(mongoose.connection.db!);
        expect(result.backfilledDocs).toBe(1);

        const updated = await mongoose.connection
            .db!.collection(INVOICES_COLLECTION)
            .findOne({ _id: id });
        expect(updated?.payeeSnapshot).toEqual({
            recipientName: 'ФОП Іваненко',
            iban: 'UA213223130000026007233566001',
            taxId: '1234567899',
            paymentPurpose: 'Custom invoice', // user-set preserved
        });
    });

    it('backfill: paymentPurpose=null → resolve через business template', async () => {
        await seedBusiness({
            paymentPurposeTemplate: 'Послуги web-розробки',
        });
        const id = await seedInvoice({ paymentPurpose: null });

        await runMigration(mongoose.connection.db!);

        const updated = await mongoose.connection
            .db!.collection(INVOICES_COLLECTION)
            .findOne({ _id: id });
        expect(updated?.payeeSnapshot?.paymentPurpose).toBe(
            'Послуги web-розробки'
        );
    });

    it('idempotent: повторний run для already-snapshotted invoices — no-op', async () => {
        await seedBusiness();
        await seedInvoice();

        await runMigration(mongoose.connection.db!);
        const second = await runMigration(mongoose.connection.db!);

        expect(second.backfilledDocs).toBe(0);
    });

    it('explicit payeeSnapshot=null теж тригерить backfill ($or filter)', async () => {
        await seedBusiness();
        const id = await seedInvoice({ payeeSnapshot: null });

        const result = await runMigration(mongoose.connection.db!);
        expect(result.backfilledDocs).toBe(1);

        const updated = await mongoose.connection
            .db!.collection(INVOICES_COLLECTION)
            .findOne({ _id: id });
        expect(updated?.payeeSnapshot).not.toBeNull();
        expect(updated?.payeeSnapshot?.recipientName).toBe('ФОП Іваненко');
    });

    it('multiple invoices — усі backfill-ляться за один bulkWrite call', async () => {
        await seedBusiness();
        await seedInvoice({
            slug: 'inv-001-aaaaaaaa',
            slugCounter: 1,
            paymentPurpose: 'A',
        });
        await seedInvoice({
            _id: new mongoose.Types.ObjectId(),
            slug: 'inv-002-bbbbbbbb',
            slugCounter: 2,
            paymentPurpose: null, // inherit
        });
        await seedInvoice({
            _id: new mongoose.Types.ObjectId(),
            slug: 'inv-003-cccccccc',
            slugCounter: 3,
            paymentPurpose: 'C',
        });

        const result = await runMigration(mongoose.connection.db!);
        expect(result.backfilledDocs).toBe(3);

        const all = await mongoose.connection
            .db!.collection(INVOICES_COLLECTION)
            .find({})
            .toArray();
        expect(all.every((d) => d.payeeSnapshot !== null)).toBe(true);
        // Mid-doc paymentPurpose=null → snapshot.paymentPurpose = template.
        const mid = all.find((d) => d.slug === 'inv-002-bbbbbbbb');
        expect(mid?.payeeSnapshot?.paymentPurpose).toBe('Оплата за послуги');
    });
});
