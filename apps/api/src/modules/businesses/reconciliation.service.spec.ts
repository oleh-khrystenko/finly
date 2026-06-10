import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import type { BusinessType } from '@finly/types';

import { createReplSetMongo, type InMemoryMongo } from '../../test-utils/mongo';
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
import { UsersService } from '../users/users.service';

type BillingLike = {
    planCode: string | null;
    hasActiveSubscription: boolean;
    subscriptionStatus: string | null;
    oneOffLevel: string | null;
    oneOffAccessUntil: Date | null;
} | null;

function billingFor(level: 'none' | 'brand' | 'bookkeeper'): BillingLike {
    if (level === 'none') return null;
    return {
        planCode: level,
        hasActiveSubscription: true,
        subscriptionStatus: 'ACTIVE',
        oneOffLevel: null,
        oneOffAccessUntil: null,
    };
}

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
    const usersService = { findById: jest.fn() };

    const userId = new Types.ObjectId();

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
                ]),
            ],
            providers: [
                ReconciliationService,
                SlugGeneratorService,
                { provide: UsersService, useValue: usersService },
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
        jest.clearAllMocks();
    });

    function setLevel(level: 'none' | 'brand' | 'bookkeeper'): void {
        usersService.findById.mockResolvedValue({ billing: billingFor(level) });
    }

    let seq = 0;
    async function seedBusiness(opts: {
        type: BusinessType;
        owned: boolean;
        blocked?: boolean;
        slugCustomized?: boolean;
    }): Promise<Types.ObjectId> {
        const _id = new Types.ObjectId();
        const n = seq++;
        await businessModel.collection.insertOne({
            _id,
            type: opts.type,
            ownerId: opts.owned ? userId : null,
            managers: opts.owned ? [] : [userId],
            slug: `biz-${n}`,
            slugLower: `biz-${n}`,
            slugCustomized: opts.slugCustomized ?? false,
            accessBlockedAt: opts.blocked ? new Date() : null,
            createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)),
            updatedAt: new Date(),
        });
        return _id;
    }

    async function isBlocked(id: Types.ObjectId): Promise<boolean> {
        const doc = await businessModel.findById(id).lean();
        return doc?.accessBlockedAt != null;
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

    // ── Block / unblock (4a) ──────────────────────────────────────────────

    it('drop to none: найстаріше ТОВ виживає, новіше блокується', async () => {
        setLevel('none');
        const oldest = await seedBusiness({ type: 'tov', owned: true });
        const newer = await seedBusiness({ type: 'tov', owned: true });

        await service.reconcile(userId.toString());

        expect(await isBlocked(oldest)).toBe(false);
        expect(await isBlocked(newer)).toBe(true);
    });

    it('фізособа і ФОП ніколи не блокуються (інваріант ≤1)', async () => {
        setLevel('none');
        const ind = await seedBusiness({ type: 'individual', owned: true });
        const fop = await seedBusiness({ type: 'fop', owned: true });

        await service.reconcile(userId.toString());

        expect(await isBlocked(ind)).toBe(false);
        expect(await isBlocked(fop)).toBe(false);
    });

    it('клієнтські понад 10 на none: виживають найстаріші 10', async () => {
        setLevel('none');
        const ids: Types.ObjectId[] = [];
        for (let i = 0; i < 12; i++) {
            ids.push(await seedBusiness({ type: 'tov', owned: false }));
        }

        await service.reconcile(userId.toString());

        expect(await isBlocked(ids[9])).toBe(false);
        expect(await isBlocked(ids[10])).toBe(true);
        expect(await isBlocked(ids[11])).toBe(true);
    });

    it('bookkeeper: без ліміту, знімає блокування з раніше заблокованих ТОВ', async () => {
        setLevel('bookkeeper');
        const a = await seedBusiness({
            type: 'tov',
            owned: true,
            blocked: true,
        });
        const b = await seedBusiness({
            type: 'tov',
            owned: true,
            blocked: true,
        });
        const c = await seedBusiness({ type: 'tov', owned: true });

        await service.reconcile(userId.toString());

        expect(await isBlocked(a)).toBe(false);
        expect(await isBlocked(b)).toBe(false);
        expect(await isBlocked(c)).toBe(false);
    });

    it('повернення доступу (none→bookkeeper) розблоковує зайві', async () => {
        const oldest = await seedBusiness({ type: 'tov', owned: true });
        const newer = await seedBusiness({ type: 'tov', owned: true });

        setLevel('none');
        await service.reconcile(userId.toString());
        expect(await isBlocked(newer)).toBe(true);

        setLevel('bookkeeper');
        await service.reconcile(userId.toString());
        expect(await isBlocked(oldest)).toBe(false);
        expect(await isBlocked(newer)).toBe(false);
    });

    it('невідомий користувач → no-op', async () => {
        usersService.findById.mockResolvedValue(null);
        await expect(
            service.reconcile(new Types.ObjectId().toString())
        ).resolves.toBeUndefined();
    });

    // ── Slug-rent (4b) ────────────────────────────────────────────────────

    it('drop to none: кастомний slug скидається до авто, старе ім’я → history redirect:false', async () => {
        setLevel('none');
        const id = await seedBusiness({
            type: 'tov',
            owned: true,
            slugCustomized: true,
        });
        const before = await businessModel.findById(id).lean();
        const oldLower = before!.slugLower;

        await service.reconcile(userId.toString());

        const after = await businessModel.findById(id).lean();
        expect(after!.slugLower).not.toBe(oldLower);
        expect(after!.slugCustomized).toBe(false);

        const hist = await historyModel.findOne({ slugLower: oldLower }).lean();
        expect(hist).not.toBeNull();
        expect(hist!.redirect).toBe(false);
    });

    it('brand зберігає кастомний slug (вище порога редагування)', async () => {
        setLevel('brand');
        const id = await seedBusiness({
            type: 'tov',
            owned: true,
            slugCustomized: true,
        });
        const before = await businessModel.findById(id).lean();

        await service.reconcile(userId.toString());

        const after = await businessModel.findById(id).lean();
        expect(after!.slugLower).toBe(before!.slugLower);
        expect(after!.slugCustomized).toBe(true);
    });

    it('ідемпотентність slug-reset: повторний прогін не чіпає вже-авто slug', async () => {
        setLevel('none');
        const id = await seedBusiness({
            type: 'tov',
            owned: true,
            slugCustomized: true,
        });

        await service.reconcile(userId.toString());
        const first = await businessModel.findById(id).lean();
        await service.reconcile(userId.toString());
        const second = await businessModel.findById(id).lean();

        expect(second!.slugLower).toBe(first!.slugLower);
        expect(second!.slugCustomized).toBe(false);
        const count = await historyModel.countDocuments({ businessId: id });
        expect(count).toBe(1);
    });

    it('blocked-бізнес теж скидає кастомний slug (ім’я повертається ринку)', async () => {
        setLevel('none');
        const oldest = await seedBusiness({
            type: 'tov',
            owned: true,
            slugCustomized: true,
        });
        const newer = await seedBusiness({
            type: 'tov',
            owned: true,
            slugCustomized: true,
        });

        await service.reconcile(userId.toString());

        expect(await isBlocked(newer)).toBe(true);
        const newerDoc = await businessModel.findById(newer).lean();
        expect(newerDoc!.slugCustomized).toBe(false);
        const oldestDoc = await businessModel.findById(oldest).lean();
        expect(oldestDoc!.slugCustomized).toBe(false);
    });

    // ── Nested slug-rent (4c) ─────────────────────────────────────────────

    it('drop to none: кастомний slug реквізитів скидається, старе ім’я → account-history redirect:false', async () => {
        setLevel('none');
        const bizId = await seedBusiness({ type: 'tov', owned: true });
        const accId = await seedAccount(bizId, true);
        const before = await accountModel.findById(accId).lean();
        const oldLower = before!.slugLower;

        await service.reconcile(userId.toString());

        const after = await accountModel.findById(accId).lean();
        expect(after!.slugLower).not.toBe(oldLower);
        expect(after!.slugCustomized).toBe(false);
        const hist = await accountHistoryModel
            .findOne({ slugLower: oldLower })
            .lean();
        expect(hist?.redirect).toBe(false);
    });

    it('drop to none: кастомний slug рахунку скидається + counter обнуляється', async () => {
        setLevel('none');
        const bizId = await seedBusiness({ type: 'tov', owned: true });
        const accId = await seedAccount(bizId, false);
        const invId = await seedInvoice(bizId, accId, true);
        const before = await invoiceModel.findById(invId).lean();
        const oldLower = before!.slugLower;

        await service.reconcile(userId.toString());

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

    it('brand зберігає кастомні slug реквізитів і рахунків', async () => {
        setLevel('brand');
        const bizId = await seedBusiness({ type: 'tov', owned: true });
        const accId = await seedAccount(bizId, true);
        const invId = await seedInvoice(bizId, accId, true);

        await service.reconcile(userId.toString());

        const acc = await accountModel.findById(accId).lean();
        const inv = await invoiceModel.findById(invId).lean();
        expect(acc!.slugCustomized).toBe(true);
        expect(inv!.slugCustomized).toBe(true);
    });

    it('drop to none: авто-slug (slugCustomized=false) не чіпається', async () => {
        setLevel('none');
        const bizId = await seedBusiness({ type: 'tov', owned: true });
        const accId = await seedAccount(bizId, false);
        const before = await accountModel.findById(accId).lean();

        await service.reconcile(userId.toString());

        const after = await accountModel.findById(accId).lean();
        expect(after!.slugLower).toBe(before!.slugLower);
        expect(after!.slugCustomized).toBe(false);
    });
});
