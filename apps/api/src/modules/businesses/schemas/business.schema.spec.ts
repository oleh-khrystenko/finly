import { BusinessSchema as BusinessZodSchema } from '@finly/types';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model, Types } from 'mongoose';

import { Business, BusinessSchema } from './business.schema';

const VALID_TAX_ID = '1234567899';

const buildFixture = (overrides: Partial<Business> = {}) => ({
    type: 'fop' as const,
    ownerId: new Types.ObjectId(),
    managers: [] as Types.ObjectId[],
    slug: 'IvanEnko-FOP',
    slugLower: 'ivanenko-fop',
    name: 'Іваненко',
    taxId: VALID_TAX_ID,
    taxationSystem: 'simplified-3' as const,
    paymentPurposeTemplate: 'Оплата за послуги',
    ...overrides,
});

describe('Business schema (Mongoose integration) — Sprint 9 §SP-1', () => {
    let mongoServer: MongoMemoryServer;
    let BusinessModel: Model<Business>;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        await mongoose.connect(mongoServer.getUri());
        BusinessModel = mongoose.model<Business>(Business.name, BusinessSchema);
        await BusinessModel.syncIndexes();
    }, 60_000);

    afterAll(async () => {
        await mongoose.disconnect();
        await mongoServer.stop();
    });

    afterEach(async () => {
        await BusinessModel.deleteMany({});
    });

    it('persists owned business with required fields and applies defaults', async () => {
        const doc = await BusinessModel.create(
            buildFixture({ isVatPayer: false })
        );

        expect(doc._id).toBeDefined();
        expect(doc.type).toBe('fop');
        expect(doc.taxId).toBe(VALID_TAX_ID);
        expect(doc.deletedAt).toBeNull();
        expect(doc.managers).toEqual([]);
        expect(doc.taxationSystem).toBe('simplified-3');
        expect(doc.isVatPayer).toBe(false);
        expect(doc.seoIndexEnabled).toBe(false); // default
        expect(doc.createdAt).toBeInstanceOf(Date);
        expect(doc.updatedAt).toBeInstanceOf(Date);
    });

    it('persists ownerless business (ownerId=null with at least one manager)', async () => {
        const managerId = new Types.ObjectId();
        const doc = await BusinessModel.create(
            buildFixture({ ownerId: null, managers: [managerId] })
        );

        expect(doc.ownerId).toBeNull();
        expect(doc.managers).toHaveLength(1);
        expect(doc.managers[0]?.equals(managerId)).toBe(true);
    });

    it('preserves case у display slug (Sprint 3 E1 case-preserved)', async () => {
        const doc = await BusinessModel.create(
            buildFixture({ slug: 'IvanEnko-FOP', slugLower: 'ivanenko-fop' })
        );
        expect(doc.slug).toBe('IvanEnko-FOP');
        expect(doc.slugLower).toBe('ivanenko-fop');
    });

    it('lowercases slugLower на insert (Mongoose lowercase modifier)', async () => {
        const doc = await BusinessModel.create(
            buildFixture({ slug: 'IvanEnko', slugLower: 'IvanEnko' })
        );
        expect(doc.slugLower).toBe('ivanenko');
    });

    it('creates expected indexes (slugLower unique, ownerId sparse, managers)', async () => {
        const indexes = await BusinessModel.collection.indexes();

        const slugLowerIdx = indexes.find((i) => i.key.slugLower === 1);
        expect(slugLowerIdx?.unique).toBe(true);

        const slugIdx = indexes.find(
            (i) => i.key.slug === 1 && Object.keys(i.key).length === 1
        );
        expect(slugIdx).toBeUndefined();

        const ownerIdx = indexes.find((i) => i.key.ownerId === 1);
        expect(ownerIdx).toBeDefined();
        expect(ownerIdx?.sparse).toBe(true);

        const managersIdx = indexes.find((i) => i.key.managers === 1);
        expect(managersIdx).toBeDefined();
    });

    it('rejects duplicate slugLower with MongoServerError code 11000', async () => {
        await BusinessModel.create(
            buildFixture({ slug: 'IvanEnko', slugLower: 'ivanenko' })
        );

        await expect(
            BusinessModel.create(
                buildFixture({
                    slug: 'IVANENKO',
                    slugLower: 'ivanenko',
                    ownerId: new Types.ObjectId(),
                })
            )
        ).rejects.toMatchObject({ code: 11000 });
    });

    it('rejects unknown business type', async () => {
        await expect(
            BusinessModel.create(
                buildFixture({ type: 'sole-proprietor' as unknown as 'fop' })
            )
        ).rejects.toThrow(/sole-proprietor.*enum/i);
    });

    it('Sprint 7 — приймає всі 4 BusinessType-літерали', async () => {
        for (const type of [
            'individual',
            'fop',
            'tov',
            'organization',
        ] as const) {
            const doc = await BusinessModel.create(
                buildFixture({
                    type: type as 'fop',
                    slug: `Slug${type}`,
                    slugLower: `slug${type}`,
                    ownerId: new Types.ObjectId(),
                    taxId:
                        type === 'tov' || type === 'organization'
                            ? '12345678'
                            : VALID_TAX_ID,
                    taxationSystem:
                        type === 'fop' || type === 'tov'
                            ? ('simplified-3' as const)
                            : (null as unknown as 'simplified-3'),
                    isVatPayer:
                        type === 'fop' || type === 'tov'
                            ? false
                            : (null as unknown as boolean),
                })
            );
            expect(doc.type).toBe(type);
        }
    });

    it('rejects unknown taxationSystem', async () => {
        await expect(
            BusinessModel.create(
                buildFixture({
                    taxationSystem:
                        'simplified-99' as unknown as 'simplified-3',
                })
            )
        ).rejects.toThrow(/simplified-99.*enum/i);
    });

    it('rejects missing required name', async () => {
        const { name: _name, ...withoutName } = buildFixture();
        await expect(
            BusinessModel.create(withoutName as unknown as Business)
        ).rejects.toThrow();
    });

    it('rejects missing required taxId (Sprint 9 §SP-1 top-level)', async () => {
        const { taxId: _omit, ...without } = buildFixture();
        await expect(
            BusinessModel.create(without as unknown as Business)
        ).rejects.toThrow();
    });

    it('rejects missing required slugLower', async () => {
        const { slugLower: _omit, ...without } = buildFixture();
        await expect(
            BusinessModel.create(without as unknown as Business)
        ).rejects.toThrow();
    });

    it('Sprint 7 §SP-3 — приймає документ без taxationSystem (default null для individual)', async () => {
        const {
            taxationSystem: _omit,
            isVatPayer: _omit2,
            ...without
        } = buildFixture();
        void _omit;
        void _omit2;
        const doc = await BusinessModel.create({
            ...(without as unknown as Business),
            type: 'individual' as const,
        });
        expect(doc.taxationSystem).toBeNull();
        expect(doc.isVatPayer).toBeNull();
    });

    // -----------------------------------------------------------------------
    // Sprint 9 §SP-1 — Mongoose ↔ Zod entity round-trip з flat taxId.
    // -----------------------------------------------------------------------
    describe('Sprint 9 §SP-1 — Mongoose ↔ Zod entity round-trip', () => {
        const httpify = (doc: unknown): unknown =>
            JSON.parse(JSON.stringify(doc));

        it('ФОП-документ з top-level taxId проходить Zod-load', async () => {
            const saved = await BusinessModel.create(
                buildFixture({
                    isVatPayer: false,
                    taxationSystem: 'simplified-3',
                })
            );
            const reloaded = await BusinessModel.findById(saved._id).orFail();
            const result = BusinessZodSchema.safeParse(httpify(reloaded));
            if (!result.success) {
                throw new Error(
                    `fop doc failed Zod-load: ${JSON.stringify(result.error.issues)}`
                );
            }
            expect(result.data.type).toBe('fop');
            expect(result.data.taxId).toBe(VALID_TAX_ID);
        });

        it('individual-документ з null taxation проходить round-trip', async () => {
            const saved = await BusinessModel.create(
                buildFixture({
                    type: 'individual',
                    slug: 'Ivan-Solo',
                    slugLower: 'ivan-solo',
                    taxationSystem: null as unknown as 'simplified-3',
                    isVatPayer: null as unknown as boolean,
                })
            );
            const reloaded = await BusinessModel.findById(saved._id).orFail();
            const result = BusinessZodSchema.safeParse(httpify(reloaded));
            if (!result.success) {
                throw new Error(
                    `Individual doc failed Zod-load: ${JSON.stringify(result.error.issues)}`
                );
            }
            expect(result.data.type).toBe('individual');
            expect(result.data.taxationSystem).toBeNull();
        });

        it('tov-документ з 8-digit ЄДРПОУ + non-null taxation проходить round-trip', async () => {
            const saved = await BusinessModel.create(
                buildFixture({
                    type: 'tov',
                    slug: 'Kasa-Zdorovya',
                    slugLower: 'kasa-zdorovya',
                    name: 'ТОВ Каса Здоровя',
                    taxId: '12345678',
                    taxationSystem: 'general',
                    isVatPayer: true,
                })
            );
            const reloaded = await BusinessModel.findById(saved._id).orFail();
            const result = BusinessZodSchema.safeParse(httpify(reloaded));
            if (!result.success) {
                throw new Error(
                    `TOV doc failed Zod-load: ${JSON.stringify(result.error.issues)}`
                );
            }
            expect(result.data.type).toBe('tov');
            expect(result.data.taxId).toBe('12345678');
        });

        it('Mongoose-рівень дозволяє drift-state (fop + null taxation), але Zod-entity reject-ить', async () => {
            const saved = await BusinessModel.create(
                buildFixture({
                    type: 'fop',
                    taxationSystem: null as unknown as 'simplified-3',
                    isVatPayer: null as unknown as boolean,
                })
            );
            const reloaded = await BusinessModel.findById(saved._id).orFail();
            const result = BusinessZodSchema.safeParse(httpify(reloaded));
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(
                    result.error.issues.some(
                        (i) => i.message === 'TAXATION_FIELDS_MISMATCH_TYPE'
                    )
                ).toBe(true);
            }
        });
    });
});
