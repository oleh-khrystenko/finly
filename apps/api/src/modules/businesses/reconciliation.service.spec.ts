import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import { SUBSCRIPTION_STATUS, type BusinessType } from '@finly/types';

import { createReplSetMongo, type InMemoryMongo } from '../../test-utils/mongo';
import {
    RedisLockBusyError,
    RedisLockService,
} from '../../common/services/redis-lock.service';
import { ReconciliationService } from './reconciliation.service';
import {
    AccountSlugHistory,
    AccountSlugHistoryDocument,
    AccountSlugHistorySchema,
} from '../accounts/schemas/account-slug-history.schema';
import {
    Account,
    AccountDocument,
    AccountSchema,
} from '../accounts/schemas/account.schema';
import {
    InvoiceSlugHistory,
    InvoiceSlugHistoryDocument,
    InvoiceSlugHistorySchema,
} from '../invoices/schemas/invoice-slug-history.schema';
import {
    Invoice,
    InvoiceDocument,
    InvoiceSchema,
} from '../invoices/schemas/invoice.schema';
import {
    BillingProfile,
    BillingProfileDocument,
    BillingProfileSchema,
} from '../payments/schemas/billing-profile.schema';
import {
    BusinessSlugHistory,
    BusinessSlugHistoryDocument,
    BusinessSlugHistorySchema,
} from './schemas/business-slug-history.schema';
import {
    Business,
    BusinessDocument,
    BusinessSchema,
} from './schemas/business.schema';
import { SlugGeneratorService } from './slug-generator.service';

/**
 * Sprint 27 — реконсиляція per-business: `brandedAt` тримається прикріпленням
 * бізнесу до активного (ACTIVE/PAST_DUE) Бренд-складу БУДЬ-ЯКОГО платника;
 * втрата останнього прикріплення гасить бренд-фічі (slug-rent + demote
 * логотипа). Тести — на реальному MongoMemoryReplSet (slug-reset-и йдуть у
 * транзакціях), reconcile-мьютекс замокано pass-through.
 */
describe('ReconciliationService (MongoMemoryReplSet)', () => {
    let mongo: InMemoryMongo;
    let moduleRef: TestingModule;
    let service: ReconciliationService;
    let businessModel: Model<BusinessDocument>;
    let historyModel: Model<BusinessSlugHistoryDocument>;
    let accountModel: Model<AccountDocument>;
    let accountHistoryModel: Model<AccountSlugHistoryDocument>;
    let invoiceModel: Model<InvoiceDocument>;
    let invoiceHistoryModel: Model<InvoiceSlugHistoryDocument>;
    let profileModel: Model<BillingProfileDocument>;

    // Глобальний reconcile-мьютекс — pass-through; окремий тест нижче емулює
    // busy-лок і перевіряє `false` (durable-маркер caller-а тримає retry).
    const locks = {
        withLock: jest.fn(
            (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()
        ),
    };

    beforeAll(async () => {
        mongo = await createReplSetMongo();
        moduleRef = await Test.createTestingModule({
            imports: [
                MongooseModule.forRoot(mongo.uri),
                MongooseModule.forFeature([
                    { name: Business.name, schema: BusinessSchema },
                    {
                        name: BusinessSlugHistory.name,
                        schema: BusinessSlugHistorySchema,
                    },
                    { name: Account.name, schema: AccountSchema },
                    {
                        name: AccountSlugHistory.name,
                        schema: AccountSlugHistorySchema,
                    },
                    { name: Invoice.name, schema: InvoiceSchema },
                    {
                        name: InvoiceSlugHistory.name,
                        schema: InvoiceSlugHistorySchema,
                    },
                    {
                        name: BillingProfile.name,
                        schema: BillingProfileSchema,
                    },
                ]),
            ],
            providers: [
                ReconciliationService,
                SlugGeneratorService,
                { provide: RedisLockService, useValue: locks },
            ],
        }).compile();

        service = moduleRef.get(ReconciliationService);
        businessModel = moduleRef.get(getModelToken(Business.name));
        historyModel = moduleRef.get(getModelToken(BusinessSlugHistory.name));
        accountModel = moduleRef.get(getModelToken(Account.name));
        accountHistoryModel = moduleRef.get(
            getModelToken(AccountSlugHistory.name)
        );
        invoiceModel = moduleRef.get(getModelToken(Invoice.name));
        invoiceHistoryModel = moduleRef.get(
            getModelToken(InvoiceSlugHistory.name)
        );
        profileModel = moduleRef.get(getModelToken(BillingProfile.name));
    }, 60_000);

    afterAll(async () => {
        await moduleRef.close();
        await mongo.stop();
    });

    afterEach(async () => {
        await businessModel.deleteMany({});
        await historyModel.deleteMany({});
        await accountModel.deleteMany({});
        await accountHistoryModel.deleteMany({});
        await invoiceModel.deleteMany({});
        await invoiceHistoryModel.deleteMany({});
        await profileModel.deleteMany({});
        jest.clearAllMocks();
        // clearAllMocks не скидає implementations — повертаємо pass-through.
        locks.withLock.mockImplementation(
            (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()
        );
    });

    let seq = 0;
    async function seedBusiness(opts?: {
        type?: BusinessType;
        branded?: boolean;
        slugCustomized?: boolean;
    }): Promise<Types.ObjectId> {
        const _id = new Types.ObjectId();
        const n = seq++;
        await businessModel.collection.insertOne({
            _id,
            type: opts?.type ?? 'fop',
            ownerId: new Types.ObjectId(),
            managers: [],
            // Унікальний per-seed: partial-unique індекси `(ownerId|managers,
            // taxId, type)` інакше валять сідінг кількох бізнесів одного типу.
            taxId: String(1000000000 + n),
            slug: `biz-${n}`,
            slugLower: `biz-${n}`,
            slugCustomized: opts?.slugCustomized ?? false,
            brandedAt: opts?.branded ? new Date() : null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        return _id;
    }

    /** Профіль платника з прикріпленнями у Бренд/Документному складі. */
    async function seedProfile(opts: {
        status: string;
        brandAttached?: Types.ObjectId[];
        documentsAttached?: Types.ObjectId[];
    }): Promise<void> {
        const brandAttached = opts.brandAttached ?? [];
        await profileModel.collection.insertOne({
            userId: new Types.ObjectId(),
            status: opts.status,
            cancelAtPeriodEnd: false,
            brand: {
                capacity: brandAttached.length,
                attachedBusinessIds: brandAttached,
                pendingCapacity: null,
                pendingKeepBusinessIds: [],
            },
            documents: {
                tierSize: opts.documentsAttached?.length ? 1 : null,
                attachedBusinessIds: opts.documentsAttached ?? [],
                credits: { balance: 0, storageBytesUsed: 0 },
                pendingTierSize: null,
                pendingKeepBusinessIds: [],
            },
            pendingReconcileBusinessIds: [],
            createdAt: new Date(),
            updatedAt: new Date(),
        });
    }

    async function isBranded(id: Types.ObjectId): Promise<boolean> {
        const doc = await businessModel.findById(id).lean();
        return doc?.brandedAt != null;
    }

    async function seedAccount(
        businessId: Types.ObjectId,
        slugCustomized: boolean
    ): Promise<Types.ObjectId> {
        const _id = new Types.ObjectId();
        const n = seq++;
        await accountModel.collection.insertOne({
            _id,
            businessId,
            slug: `acc-${n}`,
            slugLower: `acc-${n}`,
            slugCustomized,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        return _id;
    }

    async function seedInvoice(
        businessId: Types.ObjectId,
        accountId: Types.ObjectId,
        slugCustomized: boolean
    ): Promise<Types.ObjectId> {
        const _id = new Types.ObjectId();
        const n = seq++;
        await invoiceModel.collection.insertOne({
            _id,
            businessId,
            accountId,
            slug: `inv-${n}`,
            slugLower: `inv-${n}`,
            slugCustomized,
            slugCounterScope: 'all',
            slugCounter: n,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        return _id;
    }

    function reconcile(ids: Types.ObjectId[]): Promise<boolean> {
        return service.reconcileBusinesses(ids.map((id) => id.toString()));
    }

    // ── brandedAt: прикріплення до активного Бренд-складу ────────────────

    it('прикріплений до ACTIVE Бренд-складу → brandedAt виставлено; неприкріплений → знято', async () => {
        const attached = await seedBusiness();
        const detached = await seedBusiness({ branded: true });
        await seedProfile({
            status: SUBSCRIPTION_STATUS.ACTIVE,
            brandAttached: [attached],
        });

        await expect(reconcile([attached, detached])).resolves.toBe(true);

        expect(await isBranded(attached)).toBe(true);
        expect(await isBranded(detached)).toBe(false);
    });

    it('PAST_DUE-склад тримає бренд (грейс); CANCELED/INCOMPLETE — ні', async () => {
        const graced = await seedBusiness();
        const lapsed = await seedBusiness({ branded: true });
        const incomplete = await seedBusiness({ branded: true });
        await seedProfile({
            status: SUBSCRIPTION_STATUS.PAST_DUE,
            brandAttached: [graced],
        });
        await seedProfile({
            status: SUBSCRIPTION_STATUS.CANCELED,
            brandAttached: [lapsed],
        });
        await seedProfile({
            status: SUBSCRIPTION_STATUS.INCOMPLETE,
            brandAttached: [incomplete],
        });

        await reconcile([graced, lapsed, incomplete]);

        expect(await isBranded(graced)).toBe(true);
        expect(await isBranded(lapsed)).toBe(false);
        expect(await isBranded(incomplete)).toBe(false);
    });

    it('документний склад НЕ брендує: бренд-фічі лише по Бренд-прикріпленню', async () => {
        const docsOnly = await seedBusiness({ branded: true });
        await seedProfile({
            status: SUBSCRIPTION_STATUS.ACTIVE,
            documentsAttached: [docsOnly],
        });

        await reconcile([docsOnly]);

        expect(await isBranded(docsOnly)).toBe(false);
    });

    it('кілька платників: бренд живе, поки лишається хоч одне активне прикріплення', async () => {
        const shared = await seedBusiness({ branded: true });
        await seedProfile({
            status: SUBSCRIPTION_STATUS.CANCELED,
            brandAttached: [shared],
        });
        await seedProfile({
            status: SUBSCRIPTION_STATUS.ACTIVE,
            brandAttached: [shared],
        });

        await reconcile([shared]);
        expect(await isBranded(shared)).toBe(true);

        // Останнє активне прикріплення гасне → бренд гасне.
        await profileModel.updateMany(
            { status: SUBSCRIPTION_STATUS.ACTIVE },
            { $set: { status: SUBSCRIPTION_STATUS.UNPAID } }
        );
        await reconcile([shared]);
        expect(await isBranded(shared)).toBe(false);
    });

    it('ідемпотентність brandedAt: повторний прогін не пересуває наявний стемп', async () => {
        const id = await seedBusiness();
        await seedProfile({
            status: SUBSCRIPTION_STATUS.ACTIVE,
            brandAttached: [id],
        });

        await reconcile([id]);
        const first = (await businessModel.findById(id).lean())!.brandedAt;
        await reconcile([id]);
        const second = (await businessModel.findById(id).lean())!.brandedAt;

        expect(second!.getTime()).toBe(first!.getTime());
    });

    // ── Slug-rent (втрата бренду) ─────────────────────────────────────────

    it('втрата бренду: кастомний slug скидається до авто, старе ім’я → history redirect:false', async () => {
        const id = await seedBusiness({ branded: true, slugCustomized: true });
        const before = await businessModel.findById(id).lean();
        const oldLower = before!.slugLower;

        await expect(reconcile([id])).resolves.toBe(true);

        const after = await businessModel.findById(id).lean();
        expect(after!.slugLower).not.toBe(oldLower);
        expect(after!.slugCustomized).toBe(false);

        const hist = await historyModel.findOne({ slugLower: oldLower }).lean();
        expect(hist).not.toBeNull();
        expect(hist!.redirect).toBe(false);
    });

    it('брендований зберігає кастомний slug', async () => {
        const id = await seedBusiness({ slugCustomized: true });
        await seedProfile({
            status: SUBSCRIPTION_STATUS.ACTIVE,
            brandAttached: [id],
        });
        const before = await businessModel.findById(id).lean();

        await reconcile([id]);

        const after = await businessModel.findById(id).lean();
        expect(after!.slugLower).toBe(before!.slugLower);
        expect(after!.slugCustomized).toBe(true);
    });

    it('ідемпотентність slug-reset: повторний прогін не чіпає вже-авто slug', async () => {
        const id = await seedBusiness({ branded: true, slugCustomized: true });

        await reconcile([id]);
        const first = await businessModel.findById(id).lean();
        await reconcile([id]);
        const second = await businessModel.findById(id).lean();

        expect(second!.slugLower).toBe(first!.slugLower);
        expect(second!.slugCustomized).toBe(false);
        const count = await historyModel.countDocuments({ businessId: id });
        expect(count).toBe(1);
    });

    // ── Nested slug-rent ──────────────────────────────────────────────────

    it('втрата бренду: кастомний slug реквізитів скидається, старе ім’я → account-history redirect:false', async () => {
        const bizId = await seedBusiness({ branded: true });
        const accId = await seedAccount(bizId, true);
        const before = await accountModel.findById(accId).lean();
        const oldLower = before!.slugLower;

        await reconcile([bizId]);

        const after = await accountModel.findById(accId).lean();
        expect(after!.slugLower).not.toBe(oldLower);
        expect(after!.slugCustomized).toBe(false);
        const hist = await accountHistoryModel
            .findOne({ slugLower: oldLower })
            .lean();
        expect(hist?.redirect).toBe(false);
    });

    it('втрата бренду: кастомний slug рахунку скидається + counter обнуляється', async () => {
        const bizId = await seedBusiness({ branded: true });
        const accId = await seedAccount(bizId, false);
        const invId = await seedInvoice(bizId, accId, true);
        const before = await invoiceModel.findById(invId).lean();
        const oldLower = before!.slugLower;

        await reconcile([bizId]);

        const after = await invoiceModel.findById(invId).lean();
        expect(after!.slugLower).not.toBe(oldLower);
        expect(after!.slugCustomized).toBe(false);
        expect(after!.slugCounter).toBeNull();
        expect(after!.slugCounterScope).toBeNull();
        const hist = await invoiceHistoryModel
            .findOne({ slugLower: oldLower })
            .lean();
        expect(hist?.redirect).toBe(false);
    });

    it('брендований зберігає кастомні slug реквізитів і рахунків', async () => {
        const bizId = await seedBusiness();
        await seedProfile({
            status: SUBSCRIPTION_STATUS.ACTIVE,
            brandAttached: [bizId],
        });
        const accId = await seedAccount(bizId, true);
        const invId = await seedInvoice(bizId, accId, true);

        await reconcile([bizId]);

        const acc = await accountModel.findById(accId).lean();
        const inv = await invoiceModel.findById(invId).lean();
        expect(acc!.slugCustomized).toBe(true);
        expect(inv!.slugCustomized).toBe(true);
    });

    it('втрата бренду: авто-slug (slugCustomized=false) не чіпається', async () => {
        const bizId = await seedBusiness({ branded: true });
        const accId = await seedAccount(bizId, false);
        const before = await accountModel.findById(accId).lean();

        await reconcile([bizId]);

        const after = await accountModel.findById(accId).lean();
        expect(after!.slugLower).toBe(before!.slugLower);
        expect(after!.slugCustomized).toBe(false);
    });

    // ── Неповний прогін (збій per-entity reset-а / busy-лок) ─────────────

    it('збій одного slug-reset-а: прогін → false, решта батча не зривається; retry добиває → true', async () => {
        const failing = await seedBusiness({
            branded: true,
            slugCustomized: true,
        });
        const bizId = await seedBusiness({ branded: true });
        const accId = await seedAccount(bizId, true);

        const generator = moduleRef.get(SlugGeneratorService);
        const genSpy = jest
            .spyOn(generator, 'generateRandomSlug')
            .mockRejectedValueOnce(new Error('transient Mongo failure'));

        await expect(reconcile([failing, bizId])).resolves.toBe(false);

        // Збійний reset відкладено: slugCustomized лишився true (retry побачить).
        const failedDoc = await businessModel.findById(failing).lean();
        expect(failedDoc!.slugCustomized).toBe(true);
        // Решта батча (account-reset) виконалась попри збій сусіда.
        const accDoc = await accountModel.findById(accId).lean();
        expect(accDoc!.slugCustomized).toBe(false);

        // Наступний тригер (генератор знову живий) добиває reset — повний прохід.
        genSpy.mockRestore();
        await expect(reconcile([failing, bizId])).resolves.toBe(true);
        const retried = await businessModel.findById(failing).lean();
        expect(retried!.slugCustomized).toBe(false);
    });

    it('reconcile-мьютекс зайнятий на всі ретраї → false, стан не чіпається', async () => {
        const id = await seedBusiness({ branded: true, slugCustomized: true });
        locks.withLock.mockImplementation(async () => {
            throw new RedisLockBusyError('billing_reconcile:all');
        });

        await expect(reconcile([id])).resolves.toBe(false);

        // Жодного запису поза мьютексом: durable-маркер caller-а тримає retry.
        const doc = await businessModel.findById(id).lean();
        expect(doc!.brandedAt).not.toBeNull();
        expect(doc!.slugCustomized).toBe(true);
    }, 15_000);

    it('порожній список → true без взяття мьютекса', async () => {
        await expect(service.reconcileBusinesses([])).resolves.toBe(true);
        expect(locks.withLock).not.toHaveBeenCalled();
    });

    // ── Brand logo promote / demote ───────────────────────────────────────

    const SLOT = {
        logoUrl: 'https://media/brand-logos/x/a.png',
        centerMarkUrl: 'https://media/brand-logos/x/c.png',
        bandMarkUrl: 'https://media/brand-logos/x/b.png',
        displayName: 'Бренд',
    };

    async function setBrand(
        id: Types.ObjectId,
        brand: Record<string, unknown> | null
    ): Promise<void> {
        await businessModel.updateOne({ _id: id }, { $set: { brand } });
    }

    async function getBrand(
        id: Types.ObjectId
    ): Promise<{ active: unknown; pending: unknown } | null> {
        const doc = await businessModel.findById(id).lean();
        return (doc?.brand as { active: unknown; pending: unknown }) ?? null;
    }

    it('втрата бренду: активний логотип демоутиться у pending (файл лишається)', async () => {
        const id = await seedBusiness({ branded: true });
        await setBrand(id, { active: SLOT, pending: null });

        await reconcile([id]);

        const brand = await getBrand(id);
        expect(brand?.active).toBeNull();
        expect(brand?.pending).toMatchObject({
            logoUrl: SLOT.logoUrl,
            centerMarkUrl: SLOT.centerMarkUrl,
            bandMarkUrl: SLOT.bandMarkUrl,
            // Демоутований платний логотип помічений для довгого порогу чистки.
            demoted: true,
        });
        expect(
            (brand?.pending as { uploadedAt?: Date }).uploadedAt
        ).toBeTruthy();
    });

    it('брендований: pending промотується в active (auto-apply після оплати)', async () => {
        const id = await seedBusiness();
        await seedProfile({
            status: SUBSCRIPTION_STATUS.ACTIVE,
            brandAttached: [id],
        });
        await setBrand(id, {
            active: null,
            pending: { ...SLOT, uploadedAt: new Date(), demoted: false },
        });

        await reconcile([id]);

        const brand = await getBrand(id);
        expect(brand?.pending).toBeNull();
        expect(brand?.active).toMatchObject({ logoUrl: SLOT.logoUrl });
    });

    it('брендований: наявний active не чіпається (ідемпотентно)', async () => {
        const id = await seedBusiness();
        await seedProfile({
            status: SUBSCRIPTION_STATUS.ACTIVE,
            brandAttached: [id],
        });
        await setBrand(id, { active: SLOT, pending: null });

        await reconcile([id]);

        const brand = await getBrand(id);
        expect(brand?.active).toMatchObject({ logoUrl: SLOT.logoUrl });
        expect(brand?.pending).toBeNull();
    });
});
