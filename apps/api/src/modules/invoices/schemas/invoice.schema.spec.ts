import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model, Types } from 'mongoose';

import { Invoice, InvoiceSchema } from './invoice.schema';

const buildFixture = (overrides: Partial<Invoice> = {}) => ({
    businessId: new Types.ObjectId(),
    accountId: new Types.ObjectId(),
    slug: 'zamovlennia-147-aB3xQ9k7',
    amount: 150000, // 1500.00 грн у копійках
    amountLocked: true,
    paymentPurpose: 'Оплата за замовлення №147',
    validUntil: null,
    slugPreset: null,
    ...overrides,
});

describe('Invoice schema (Mongoose integration) — Sprint 9 §SP-6', () => {
    let mongoServer: MongoMemoryServer;
    let InvoiceModel: Model<Invoice>;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        await mongoose.connect(mongoServer.getUri());
        InvoiceModel = mongoose.model<Invoice>(Invoice.name, InvoiceSchema);
        await InvoiceModel.syncIndexes();
    }, 60_000);

    afterAll(async () => {
        await mongoose.disconnect();
        await mongoServer.stop();
    });

    afterEach(async () => {
        await InvoiceModel.deleteMany({});
    });

    it('persists with all fields and applies defaults', async () => {
        const doc = await InvoiceModel.create(buildFixture());

        expect(doc._id).toBeDefined();
        expect(doc.businessId).toBeDefined();
        expect(doc.accountId).toBeDefined();
        expect(doc.deletedAt).toBeNull();
        expect(doc.slugCounterScope).toBeNull();
        expect(doc.slugCounter).toBeNull();
        expect(doc.createdAt).toBeInstanceOf(Date);
        expect(doc.updatedAt).toBeInstanceOf(Date);
    });

    it('persists signage-mode invoice (amount=null, amountLocked=false)', async () => {
        const doc = await InvoiceModel.create(
            buildFixture({ amount: null, amountLocked: false })
        );
        expect(doc.amount).toBeNull();
        expect(doc.amountLocked).toBe(false);
    });

    it('persists invoice that inherits business purpose template (paymentPurpose=null)', async () => {
        const doc = await InvoiceModel.create(
            buildFixture({ paymentPurpose: null })
        );
        expect(doc.paymentPurpose).toBeNull();
    });

    it.each(['simple', 'with-month', 'with-year', 'with-purpose'] as const)(
        'persists invoice with slugPreset=%s',
        async (preset) => {
            const doc = await InvoiceModel.create(
                buildFixture({ slugPreset: preset })
            );
            expect(doc.slugPreset).toBe(preset);
        }
    );

    it('Sprint 9 §SP-6 — creates expected indexes ((accountId,slug) unique, (accountId,createdAt,_id), (businessId,createdAt), validUntil sparse, partial counter-unique)', async () => {
        const indexes = await InvoiceModel.collection.indexes();

        // primary unique compound moved to (accountId, slug)
        const compoundUnique = indexes.find(
            (i) => i.key.accountId === 1 && i.key.slug === 1
        );
        expect(compoundUnique?.unique).toBe(true);

        const listIdx = indexes.find(
            (i) =>
                i.key.accountId === 1 &&
                i.key.createdAt === -1 &&
                i.key._id === -1
        );
        expect(listIdx).toBeDefined();

        // denormalized businessId index для cascade-delete-business + analytics
        const businessIdx = indexes.find(
            (i) =>
                i.key.businessId === 1 &&
                i.key.createdAt === -1 &&
                i.key._id === undefined
        );
        expect(businessIdx).toBeDefined();

        const validUntilIdx = indexes.find((i) => i.key.validUntil === 1);
        expect(validUntilIdx).toBeDefined();
        expect(validUntilIdx?.sparse).toBe(true);

        // partial-unique counter — переходить на accountId namespace
        const counterIdx = indexes.find(
            (i) =>
                i.key.accountId === 1 &&
                i.key.slugCounterScope === 1 &&
                i.key.slugCounter === 1
        );
        expect(counterIdx?.unique).toBe(true);
        expect(counterIdx?.partialFilterExpression).toEqual({
            slugCounterScope: { $type: 'string' },
            slugCounter: { $type: 'int' },
        });
    });

    it('Sprint 9 §SP-6 — counter-unique compound блокує race-collision (один account + scope + counter)', async () => {
        const accountId = new Types.ObjectId();
        await InvoiceModel.create(
            buildFixture({
                accountId,
                slug: 'inv-001-aaaaaaaa',
                slugPreset: 'simple',
                slugCounterScope: 'simple',
                slugCounter: 1,
            })
        );

        await expect(
            InvoiceModel.create(
                buildFixture({
                    accountId,
                    slug: 'inv-001-bbbbbbbb',
                    slugPreset: 'simple',
                    slugCounterScope: 'simple',
                    slugCounter: 1,
                })
            )
        ).rejects.toMatchObject({ code: 11000 });
    });

    it('Sprint 9 §SP-6 — два account-и одного бізнесу можуть мати inv-001 (per-account counter-namespace)', async () => {
        const businessId = new Types.ObjectId();
        const accountA = new Types.ObjectId();
        const accountB = new Types.ObjectId();
        await InvoiceModel.create(
            buildFixture({
                businessId,
                accountId: accountA,
                slug: 'inv-001-aaaaaaaa',
                slugPreset: 'simple',
                slugCounterScope: 'simple',
                slugCounter: 1,
            })
        );
        // Той самий counter=1 у scope='simple', але інший account → дозволено.
        await expect(
            InvoiceModel.create(
                buildFixture({
                    businessId,
                    accountId: accountB,
                    slug: 'inv-001-bbbbbbbb',
                    slugPreset: 'simple',
                    slugCounterScope: 'simple',
                    slugCounter: 1,
                })
            )
        ).resolves.toBeDefined();
    });

    it('Sprint 4 §4.1 — partial filter виключає null counter-fields', async () => {
        const accountId = new Types.ObjectId();
        await InvoiceModel.create(
            buildFixture({
                accountId,
                slug: 'aaaaaaaa',
                slugCounterScope: null,
                slugCounter: null,
            })
        );
        await expect(
            InvoiceModel.create(
                buildFixture({
                    accountId,
                    slug: 'bbbbbbbb',
                    slugCounterScope: null,
                    slugCounter: null,
                })
            )
        ).resolves.toBeDefined();
    });

    it('Sprint 4 §4.1 — counter-unique розкриває різні scope (with-month: 2026-05 vs 2026-06)', async () => {
        const accountId = new Types.ObjectId();
        await InvoiceModel.create(
            buildFixture({
                accountId,
                slug: '2026-05-001-aaaaaaaa',
                slugPreset: 'with-month',
                slugCounterScope: '2026-05',
                slugCounter: 1,
            })
        );
        await expect(
            InvoiceModel.create(
                buildFixture({
                    accountId,
                    slug: '2026-06-001-bbbbbbbb',
                    slugPreset: 'with-month',
                    slugCounterScope: '2026-06',
                    slugCounter: 1,
                })
            )
        ).resolves.toBeDefined();
    });

    it('rejects duplicate (accountId, slug) compound with code 11000', async () => {
        const accountId = new Types.ObjectId();
        await InvoiceModel.create(
            buildFixture({ accountId, slug: 'order-aB3xQ9k7' })
        );

        await expect(
            InvoiceModel.create(
                buildFixture({ accountId, slug: 'order-aB3xQ9k7' })
            )
        ).rejects.toMatchObject({ code: 11000 });
    });

    it('allows the same slug under DIFFERENT accounts (per-account uniqueness)', async () => {
        const slug = 'order-aB3xQ9k7';
        await InvoiceModel.create(
            buildFixture({ accountId: new Types.ObjectId(), slug })
        );

        const second = await InvoiceModel.create(
            buildFixture({ accountId: new Types.ObjectId(), slug })
        );
        expect(second.slug).toBe(slug);
    });

    it('rejects unknown slugPreset value', async () => {
        await expect(
            InvoiceModel.create(
                buildFixture({
                    slugPreset:
                        'with-quarter' as unknown as Invoice['slugPreset'],
                })
            )
        ).rejects.toThrow(/with-quarter.*enum/i);
    });

    it('rejects missing required businessId', async () => {
        const { businessId: _b, ...rest } = buildFixture();
        await expect(
            InvoiceModel.create(rest as unknown as Invoice)
        ).rejects.toThrow();
    });

    it('rejects missing required accountId', async () => {
        const { accountId: _a, ...rest } = buildFixture();
        await expect(
            InvoiceModel.create(rest as unknown as Invoice)
        ).rejects.toThrow();
    });

    it('does NOT enforce validUntil >= now at Mongoose layer (app-layer rule)', async () => {
        const past = new Date('2020-01-01');
        const doc = await InvoiceModel.create(
            buildFixture({ validUntil: past })
        );
        expect(doc.validUntil?.getTime()).toBe(past.getTime());
    });
});
