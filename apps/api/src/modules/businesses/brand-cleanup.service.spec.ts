import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';

import {
    createStandaloneMongo,
    type InMemoryMongo,
} from '../../test-utils/mongo';
import type { StorageService } from '../storage/storage.service';
import { BrandCleanupService } from './brand-cleanup.service';
import {
    Business,
    BusinessDocument,
    BusinessSchema,
} from './schemas/business.schema';

const MS_PER_DAY = 86_400_000;

/**
 * BrandCleanupService: cron прибирає pending-логотипи старші за поріг
 * (BRAND_PENDING_CLEANUP_DAYS=7 у test-setup), не чіпає свіжі/active, видаляє
 * файли з R2. Реальний standalone Mongo, storage — мок.
 */
describe('BrandCleanupService', () => {
    let mongo: InMemoryMongo;
    let moduleRef: TestingModule;
    let businessModel: Model<BusinessDocument>;
    let service: BrandCleanupService;
    const storage = {
        safeDeleteByUrl: jest.fn().mockResolvedValue(undefined),
    };

    beforeAll(async () => {
        mongo = await createStandaloneMongo();
        moduleRef = await Test.createTestingModule({
            imports: [
                MongooseModule.forRoot(mongo.uri),
                MongooseModule.forFeature([
                    { name: Business.name, schema: BusinessSchema },
                ]),
            ],
        }).compile();
        businessModel = moduleRef.get(getModelToken(Business.name));
        service = new BrandCleanupService(
            businessModel,
            storage as unknown as StorageService
        );
    }, 60_000);

    afterAll(async () => {
        await moduleRef.close();
        await mongo.stop();
    });

    afterEach(async () => {
        await businessModel.deleteMany({});
        jest.clearAllMocks();
    });

    const SLOT = {
        logoUrl: 'https://media/brand-logos/x/a.png',
        centerMarkUrl: 'https://media/brand-logos/x/c.png',
        bandMarkUrl: 'https://media/brand-logos/x/b.png',
        displayName: null,
    };

    async function seed(
        brand: Record<string, unknown> | null
    ): Promise<Types.ObjectId> {
        const _id = new Types.ObjectId();
        await businessModel.collection.insertOne({
            _id,
            type: 'fop',
            ownerId: new Types.ObjectId(),
            managers: [],
            slug: `b-${_id.toString()}`,
            slugLower: `b-${_id.toString()}`.toLowerCase(),
            name: 'X',
            taxId: '1234567899',
            paymentPurposeTemplate: 'Оплата',
            brand,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        return _id;
    }

    // Пороги з test-setup: free=7, demoted=90.
    function pendingAgeDays(days: number, demoted: boolean) {
        return {
            active: null,
            pending: {
                ...SLOT,
                uploadedAt: new Date(Date.now() - days * MS_PER_DAY),
                demoted,
            },
        };
    }

    it('free-pending старше за 7 днів → прибирається + видаляє файли', async () => {
        const id = await seed(pendingAgeDays(10, false));

        await service.runDailyCleanup();

        const doc = await businessModel.findById(id).lean();
        expect(doc?.brand?.pending).toBeNull();
        expect(storage.safeDeleteByUrl).toHaveBeenCalledWith(SLOT.logoUrl);
        expect(storage.safeDeleteByUrl).toHaveBeenCalledWith(
            SLOT.centerMarkUrl
        );
        expect(storage.safeDeleteByUrl).toHaveBeenCalledWith(SLOT.bandMarkUrl);
    });

    it('free-pending у межах 7 днів → не чіпається', async () => {
        const id = await seed(pendingAgeDays(1, false));

        await service.runDailyCleanup();

        const doc = await businessModel.findById(id).lean();
        expect(doc?.brand?.pending).not.toBeNull();
        expect(storage.safeDeleteByUrl).not.toHaveBeenCalled();
    });

    it('демоутований pending 10 днів → НЕ чіпається (довгий поріг 90)', async () => {
        const id = await seed(pendingAgeDays(10, true));

        await service.runDailyCleanup();

        const doc = await businessModel.findById(id).lean();
        expect(doc?.brand?.pending).not.toBeNull();
        expect(storage.safeDeleteByUrl).not.toHaveBeenCalled();
    });

    it('демоутований pending старше за 90 днів → прибирається', async () => {
        const id = await seed(pendingAgeDays(100, true));

        await service.runDailyCleanup();

        const doc = await businessModel.findById(id).lean();
        expect(doc?.brand?.pending).toBeNull();
        expect(storage.safeDeleteByUrl).toHaveBeenCalledWith(SLOT.logoUrl);
    });

    it('не чіпає active (рендериться публічно)', async () => {
        const id = await seed({ active: SLOT, pending: null });

        await service.runDailyCleanup();

        const doc = await businessModel.findById(id).lean();
        expect(doc?.brand?.active).not.toBeNull();
        expect(storage.safeDeleteByUrl).not.toHaveBeenCalled();
    });
});
