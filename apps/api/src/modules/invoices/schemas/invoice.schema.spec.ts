import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model, Types } from 'mongoose';

import { Invoice, InvoiceSchema } from './invoice.schema';

const buildFixture = (overrides: Partial<Invoice> = {}) => ({
    businessId: new Types.ObjectId(),
    slug: 'zamovlennia-147-aB3xQ9k7',
    amount: 150000, // 1500.00 грн у копійках
    amountLocked: true,
    paymentPurpose: 'Оплата за замовлення №147',
    validUntil: null,
    slugPreset: null,
    ...overrides,
});

describe('Invoice schema (Mongoose integration)', () => {
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
        expect(doc.deletedAt).toBeNull();
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

    it('creates expected indexes ((businessId,slug) unique, (businessId,createdAt), validUntil sparse)', async () => {
        const indexes = await InvoiceModel.collection.indexes();

        const compoundUnique = indexes.find(
            (i) => i.key.businessId === 1 && i.key.slug === 1
        );
        expect(compoundUnique?.unique).toBe(true);

        const listIdx = indexes.find(
            (i) => i.key.businessId === 1 && i.key.createdAt === -1
        );
        expect(listIdx).toBeDefined();

        const validUntilIdx = indexes.find((i) => i.key.validUntil === 1);
        expect(validUntilIdx).toBeDefined();
        expect(validUntilIdx?.sparse).toBe(true);
    });

    it('rejects duplicate (businessId, slug) compound with code 11000', async () => {
        const businessId = new Types.ObjectId();
        await InvoiceModel.create(
            buildFixture({ businessId, slug: 'order-aB3xQ9k7' })
        );

        await expect(
            InvoiceModel.create(
                buildFixture({ businessId, slug: 'order-aB3xQ9k7' })
            )
        ).rejects.toMatchObject({ code: 11000 });
    });

    it('allows the same slug under DIFFERENT businesses (per-business uniqueness)', async () => {
        const slug = 'order-aB3xQ9k7';
        await InvoiceModel.create(
            buildFixture({ businessId: new Types.ObjectId(), slug })
        );

        const second = await InvoiceModel.create(
            buildFixture({ businessId: new Types.ObjectId(), slug })
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

    it('does NOT enforce validUntil >= createdAt at Mongoose layer (app-layer rule)', async () => {
        // План явно фіксує цей інваріант як app-layer (time-relative rule).
        // Schema приймає past validUntil — write-side service у Sprint 4
        // блокує невалідні комбінації.
        const past = new Date('2020-01-01');
        const doc = await InvoiceModel.create(
            buildFixture({ validUntil: past })
        );
        expect(doc.validUntil?.getTime()).toBe(past.getTime());
    });
});
