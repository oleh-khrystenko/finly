import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model, Types } from 'mongoose';

import { Business, BusinessSchema } from './business.schema';

const VALID_IBAN = 'UA213223130000026007233566001';
const VALID_TAX_ID = '1234567899';

const buildFixture = (overrides: Partial<Business> = {}) => ({
    type: 'fop' as const,
    ownerId: new Types.ObjectId(),
    managers: [] as Types.ObjectId[],
    slug: 'IvanEnko-FOP',
    slugLower: 'ivanenko-fop',
    name: 'Іваненко',
    requisites: { iban: VALID_IBAN, taxId: VALID_TAX_ID },
    taxationSystem: 'simplified-3' as const,
    paymentPurposeTemplate: 'Оплата за послуги',
    acceptedBanks: ['privatbank', 'monobank'] as const,
    ...overrides,
});

describe('Business schema (Mongoose integration)', () => {
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

    it('persists owned business with all required fields and applies defaults', async () => {
        const doc = await BusinessModel.create(buildFixture());

        expect(doc._id).toBeDefined();
        expect(doc.type).toBe('fop');
        expect(doc.deletedAt).toBeNull();
        expect(doc.managers).toEqual([]);
        expect(doc.acceptedBanks).toEqual(['privatbank', 'monobank']);
        expect(doc.taxationSystem).toBe('simplified-3');
        expect(doc.isVatPayer).toBe(false); // default
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
        // Якщо service-layer випадково передасть mixed-case slugLower —
        // schema-level modifier нормалізує. Захист від drift-у в одному місці.
        const doc = await BusinessModel.create(
            buildFixture({ slug: 'IvanEnko', slugLower: 'IvanEnko' })
        );
        expect(doc.slugLower).toBe('ivanenko');
    });

    it('creates expected indexes (slugLower unique, ownerId sparse, managers)', async () => {
        const indexes = await BusinessModel.collection.indexes();

        const slugLowerIdx = indexes.find((i) => i.key.slugLower === 1);
        expect(slugLowerIdx?.unique).toBe(true);

        // `slug` НЕ повинен мати власного index — case-insensitive
        // uniqueness живе на slugLower, lookup публічної сторінки теж по
        // slugLower. Якщо тут стане index — це регресія до Sprint 1 моделі.
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

    it('rejects duplicate slugLower with MongoServerError code 11000 (case-insensitive uniqueness)', async () => {
        await BusinessModel.create(
            buildFixture({ slug: 'IvanEnko', slugLower: 'ivanenko' })
        );

        // Інший case-варіант, та сама lowercase-форма → конфлікт
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

    it('дозволяє різні slug-и з різними slugLower (case-preserved інстанси не конфліктують)', async () => {
        await BusinessModel.create(
            buildFixture({ slug: 'IvanEnko', slugLower: 'ivanenko' })
        );

        // Різний slugLower → жодного конфлікту
        await expect(
            BusinessModel.create(
                buildFixture({
                    slug: 'PetrEnko',
                    slugLower: 'petrenko',
                    ownerId: new Types.ObjectId(),
                })
            )
        ).resolves.toBeDefined();
    });

    it('rejects unknown business type', async () => {
        await expect(
            BusinessModel.create(
                buildFixture({ type: 'tov' as unknown as 'fop' })
            )
        ).rejects.toThrow(/tov.*enum/i);
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

    it('rejects unknown bank code in acceptedBanks', async () => {
        await expect(
            BusinessModel.create(
                buildFixture({
                    acceptedBanks: [
                        'privatbank',
                        'unknown_bank',
                    ] as unknown as ['privatbank', 'monobank'],
                })
            )
        ).rejects.toThrow(/unknown_bank/i);
    });

    it('rejects missing required fields', async () => {
        const { name: _name, ...withoutName } = buildFixture();
        await expect(
            BusinessModel.create(withoutName as unknown as Business)
        ).rejects.toThrow();
    });

    it('rejects missing required slugLower', async () => {
        const { slugLower: _omit, ...without } = buildFixture();
        await expect(
            BusinessModel.create(without as unknown as Business)
        ).rejects.toThrow();
    });

    it('rejects missing required taxationSystem', async () => {
        const { taxationSystem: _omit, ...without } = buildFixture();
        await expect(
            BusinessModel.create(without as unknown as Business)
        ).rejects.toThrow();
    });

    it('does NOT enforce ownerless ⇒ managers ≥ 1 invariant at Mongoose layer (app-layer rule)', async () => {
        // План явно фіксує цей інваріант як app-layer; Mongoose комбінаторного
        // правила не виразить. Тест-документ перевіряє, що схема не ламає
        // intent — інваріант живе у Zod-refine (`@finly/types`) + service-layer.
        const doc = await BusinessModel.create(
            buildFixture({ ownerId: null, managers: [] })
        );
        expect(doc.ownerId).toBeNull();
        expect(doc.managers).toEqual([]);
    });

    it('does NOT enforce coupled VAT × taxationSystem invariant at Mongoose layer (app-layer rule)', async () => {
        // Sprint 3 C1 — Mongoose не виразить comb-правила; Zod-refine у
        // `BusinessSchema` (entity) + write-DTO (`Create/UpdateBusinessSchema`)
        // — єдиний enforcement point. Тест показує, що БД пропустить
        // невалідну пару (захист від тихого drift-у policy у схемі).
        const doc = await BusinessModel.create(
            buildFixture({
                taxationSystem: 'simplified-1',
                isVatPayer: true,
            })
        );
        expect(doc.taxationSystem).toBe('simplified-1');
        expect(doc.isVatPayer).toBe(true);
    });

    it('does NOT enforce slugLower === slug.toLowerCase() invariant at Mongoose layer (app-layer rule)', async () => {
        // Mongoose `lowercase: true` modifier на slugLower нормалізує сам
        // slugLower, але **не порівнює** його з slug-полем. Drift-guard живе
        // у Zod entity-refine (`SLUG_LOWER_MISMATCH`) + service-layer.
        const doc = await BusinessModel.create(
            buildFixture({ slug: 'IvanEnko', slugLower: 'someone-else' })
        );
        expect(doc.slug).toBe('IvanEnko');
        expect(doc.slugLower).toBe('someone-else');
    });
});
