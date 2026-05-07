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
        expect(doc.slugCounterScope).toBeNull(); // Sprint 4 §4.1
        expect(doc.slugCounter).toBeNull(); // Sprint 4 §4.1
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

    it('creates expected indexes ((businessId,slug) unique, (businessId,createdAt), validUntil sparse, partial counter-unique)', async () => {
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

        // Sprint 4 §4.1 — partial-unique counter-namespace index (race-block).
        const counterIdx = indexes.find(
            (i) =>
                i.key.businessId === 1 &&
                i.key.slugCounterScope === 1 &&
                i.key.slugCounter === 1
        );
        expect(counterIdx?.unique).toBe(true);
        expect(counterIdx?.partialFilterExpression).toEqual({
            slugCounterScope: { $type: 'string' },
            slugCounter: { $type: 'int' },
        });
    });

    it('Sprint 4 §4.1 — counter-unique compound блокує race-collision (один scope + один counter)', async () => {
        const businessId = new Types.ObjectId();
        await InvoiceModel.create(
            buildFixture({
                businessId,
                slug: 'inv-001-aaaaaaaa',
                slugPreset: 'simple',
                slugCounterScope: 'simple',
                slugCounter: 1,
            })
        );

        // Той самий counter-namespace + counter, інший tail → 11000.
        await expect(
            InvoiceModel.create(
                buildFixture({
                    businessId,
                    slug: 'inv-001-bbbbbbbb',
                    slugPreset: 'simple',
                    slugCounterScope: 'simple',
                    slugCounter: 1,
                })
            )
        ).rejects.toMatchObject({ code: 11000 });
    });

    it('Sprint 4 §4.1 — partial filter виключає null counter-fields (non-counter modes)', async () => {
        // explicit/random/with-purpose: counter-fields=null. Не у index-і,
        // тож multi-insert не блокується.
        const businessId = new Types.ObjectId();
        await InvoiceModel.create(
            buildFixture({
                businessId,
                slug: 'aaaaaaaa',
                slugCounterScope: null,
                slugCounter: null,
            })
        );
        await expect(
            InvoiceModel.create(
                buildFixture({
                    businessId,
                    slug: 'bbbbbbbb',
                    slugCounterScope: null,
                    slugCounter: null,
                })
            )
        ).resolves.toBeDefined();
    });

    it('Sprint 4 §4.1 — counter-unique розкриває різні scope (with-month: 2026-05 vs 2026-06)', async () => {
        // Same `slugCounter=1` у двох різних місяцях — НЕ collision (різні
        // scope-strings 2026-05/2026-06).
        const businessId = new Types.ObjectId();
        await InvoiceModel.create(
            buildFixture({
                businessId,
                slug: '2026-05-001-aaaaaaaa',
                slugPreset: 'with-month',
                slugCounterScope: '2026-05',
                slugCounter: 1,
            })
        );
        await expect(
            InvoiceModel.create(
                buildFixture({
                    businessId,
                    slug: '2026-06-001-bbbbbbbb',
                    slugPreset: 'with-month',
                    slugCounterScope: '2026-06',
                    slugCounter: 1,
                })
            )
        ).resolves.toBeDefined();
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

    it('does NOT enforce validUntil >= now at Mongoose layer (app-layer rule)', async () => {
        // Sprint 4 review fix — інваріант `validUntil >= now` enforced у
        // `InvoicesService.create`/`.update` (write-side), не у Mongoose-
        // схемі: stale invoice з минулим validUntil має валідно існувати у
        // БД (це expired-state, видимий через `isInvoiceExpired`).
        const past = new Date('2020-01-01');
        const doc = await InvoiceModel.create(
            buildFixture({ validUntil: past })
        );
        expect(doc.validUntil?.getTime()).toBe(past.getTime());
    });
});
