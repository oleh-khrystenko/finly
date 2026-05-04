import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';

import { createReplSetMongo } from '../../test-utils/mongo';
import {
    Invoice,
    InvoiceDocument,
    InvoiceSchema,
} from '../invoices/schemas/invoice.schema';
import { BusinessesService } from './businesses.service';
import {
    Business,
    BusinessDocument,
    BusinessSchema,
} from './schemas/business.schema';
import { SlugGeneratorService } from './slug-generator.service';

/**
 * Sprint 4 §SP-5 + DoD §4.0 — integration spec для cascade-delete на
 * `MongoMemoryReplSet`. Тести покривають:
 *  1. Happy path: бізнес + N інвойсів → одна transaction видаляє всіх.
 *  2. Mid-transaction failure → rollback (нічого не видалено).
 *
 * **Чому окремий spec, не у `businesses.service.spec.ts`.** Unit-spec
 * мокує Mongo через jest-mocks і `withTransaction(cb)` запускає cb напряму
 * — це покриває control-flow логіку (call ordering, error mapping), але НЕ
 * перевіряє реальну atomicity Mongo transaction-ів. Тут — реальний
 * `MongoMemoryReplSet`, де `withTransaction` справді commits/rollbacks.
 */
describe('BusinessesService cascade-delete (Sprint 4 §SP-5, MongoMemoryReplSet)', () => {
    let mongo: Awaited<ReturnType<typeof createReplSetMongo>>;
    let moduleRef: TestingModule;
    let service: BusinessesService;
    let businessModel: Model<BusinessDocument>;
    let invoiceModel: Model<InvoiceDocument>;

    beforeAll(async () => {
        mongo = await createReplSetMongo();
        moduleRef = await Test.createTestingModule({
            imports: [
                MongooseModule.forRoot(mongo.uri),
                MongooseModule.forFeature([
                    { name: Business.name, schema: BusinessSchema },
                    { name: Invoice.name, schema: InvoiceSchema },
                ]),
            ],
            providers: [
                BusinessesService,
                {
                    provide: SlugGeneratorService,
                    useValue: { generateRandomSlug: jest.fn() },
                },
            ],
        }).compile();
        service = moduleRef.get(BusinessesService);
        businessModel = moduleRef.get(getModelToken(Business.name));
        invoiceModel = moduleRef.get(getModelToken(Invoice.name));
    }, 30_000);

    afterAll(async () => {
        await moduleRef.close();
        await mongo.stop();
    });

    beforeEach(async () => {
        await businessModel.deleteMany({});
        await invoiceModel.deleteMany({});
    });

    /** Helper: створює business + N invoices під ним. */
    async function seedBusinessWithInvoices(
        invoiceCount: number
    ): Promise<BusinessDocument> {
        const business = await businessModel.create({
            type: 'fop',
            ownerId: new Types.ObjectId(),
            managers: [],
            slug: 'IvanEnko',
            slugLower: 'ivanenko',
            name: 'Іваненко',
            requisites: {
                iban: 'UA213223130000026007233566001',
                taxId: '1234567899',
            },
            taxationSystem: 'simplified-3',
            isVatPayer: false,
            paymentPurposeTemplate: 'Оплата',
            acceptedBanks: ['privatbank'],
            seoIndexEnabled: false,
        });
        for (let i = 1; i <= invoiceCount; i++) {
            await invoiceModel.create({
                businessId: business._id,
                slug: `inv-${String(i).padStart(3, '0')}-aB3xQ9k${i}`,
                slugPreset: 'simple',
                slugCounterScope: 'simple',
                slugCounter: i,
                amount: 150000,
                amountLocked: true,
                paymentPurpose: 'Оплата',
                validUntil: null,
                deletedAt: null,
            });
        }
        return business;
    }

    it('happy path: бізнес + 3 інвойси → atomic-cascade видалення', async () => {
        const business = await seedBusinessWithInvoices(3);

        const result = await service.delete(business);

        expect(result).toEqual({ affectedInvoices: 3 });
        expect(await businessModel.findById(business._id)).toBeNull();
        expect(
            await invoiceModel.countDocuments({ businessId: business._id })
        ).toBe(0);
    });

    it('happy path: бізнес без інвойсів → affectedInvoices=0', async () => {
        const business = await seedBusinessWithInvoices(0);

        const result = await service.delete(business);
        expect(result).toEqual({ affectedInvoices: 0 });
        expect(await businessModel.findById(business._id)).toBeNull();
    });

    it('rollback on mid-transaction failure: invoices+business лишаються', async () => {
        const business = await seedBusinessWithInvoices(3);
        const otherBusinessId = new Types.ObjectId();
        await invoiceModel.create({
            businessId: otherBusinessId,
            slug: 'other-aaaaaaaa',
            slugPreset: null,
            slugCounterScope: null,
            slugCounter: null,
            amount: null,
            amountLocked: false,
            paymentPurpose: null,
            validUntil: null,
            deletedAt: null,
        });

        // Симулюємо failure всередині transaction — мокуємо Business.deleteOne
        // на throw. Mongo автоматично abort-ить scope; жоден з invoice-документів
        // не повинен зникнути.
        const deleteOneSpy = jest
            .spyOn(businessModel, 'deleteOne')
            .mockImplementationOnce(() => {
                throw new Error('Simulated mid-transaction failure');
            });

        await expect(service.delete(business)).rejects.toThrow(
            'Simulated mid-transaction failure'
        );

        // Atomic-or-nothing: жодних видалень.
        expect(await businessModel.findById(business._id)).not.toBeNull();
        expect(
            await invoiceModel.countDocuments({ businessId: business._id })
        ).toBe(3);
        // Інвойс іншого бізнесу теж недоторканий.
        expect(
            await invoiceModel.countDocuments({ businessId: otherBusinessId })
        ).toBe(1);

        deleteOneSpy.mockRestore();
    });

    it('cross-business isolation: cascade видаляє лише invoices свого business-у', async () => {
        const target = await seedBusinessWithInvoices(2);
        const other = await businessModel.create({
            type: 'fop',
            ownerId: new Types.ObjectId(),
            managers: [],
            slug: 'OtherBiz',
            slugLower: 'otherbiz',
            name: 'Other',
            requisites: {
                iban: 'UA213223130000026007233566001',
                taxId: '1234567899',
            },
            taxationSystem: 'simplified-3',
            isVatPayer: false,
            paymentPurposeTemplate: 'Other',
            acceptedBanks: ['privatbank'],
            seoIndexEnabled: false,
        });
        await invoiceModel.create({
            businessId: other._id,
            slug: 'sibling-aaaaaaaa',
            slugPreset: null,
            slugCounterScope: null,
            slugCounter: null,
            amount: null,
            amountLocked: false,
            paymentPurpose: null,
            validUntil: null,
            deletedAt: null,
        });

        await service.delete(target);

        // Target gone.
        expect(await businessModel.findById(target._id)).toBeNull();
        expect(
            await invoiceModel.countDocuments({ businessId: target._id })
        ).toBe(0);
        // Other business + його invoice — недоторкані.
        expect(await businessModel.findById(other._id)).not.toBeNull();
        expect(
            await invoiceModel.countDocuments({ businessId: other._id })
        ).toBe(1);
    });
});
