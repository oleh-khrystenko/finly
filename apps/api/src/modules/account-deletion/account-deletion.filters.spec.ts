import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { FilterQuery, Model, Types } from 'mongoose';

import { createStandaloneMongo } from '../../test-utils/mongo';
import {
    Business,
    BusinessDocument,
    BusinessSchema,
} from '../businesses/schemas/business.schema';
import {
    departingBusinessesFilter,
    survivingBusinessesFilter,
} from './account-deletion.service';

/**
 * Sprint 32 — розділення отримувачів на «підуть з людиною» і «переживуть її».
 * Перевіряється на справжньому Mongo, бо вся суть у семантиці `$not/$elemMatch`
 * і `$nor`: помилка тут або знесла б чужий запис разом з чужим архівом, або
 * лишила б у базі отримувача, за яким уже нікого немає.
 */
describe('account deletion business filters', () => {
    let mongo: Awaited<ReturnType<typeof createStandaloneMongo>>;
    let moduleRef: TestingModule;
    let businessModel: Model<BusinessDocument>;

    const user = new Types.ObjectId();
    const other = new Types.ObjectId();

    let ownedAlone: Types.ObjectId;
    let ownedWithManager: Types.ObjectId;
    let clientAlone: Types.ObjectId;
    let clientWithSecondManager: Types.ObjectId;
    let managedForLiveOwner: Types.ObjectId;
    let systemPayee: Types.ObjectId;
    let strangerBusiness: Types.ObjectId;

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
        businessModel = moduleRef.get<Model<BusinessDocument>>(
            getModelToken(Business.name)
        );

        const base = {
            type: 'fop' as const,
            taxId: '1234567890',
            paymentPurposeTemplate: 'Оплата послуг',
        };
        const make = async (
            slug: string,
            fields: Partial<Business>
        ): Promise<Types.ObjectId> => {
            const doc = await businessModel.create({
                ...base,
                slug,
                slugLower: slug,
                name: slug,
                ...fields,
            });
            return doc._id;
        };

        ownedAlone = await make('owned-alone', { ownerId: user });
        ownedWithManager = await make('owned-with-manager', {
            ownerId: user,
            managers: [other],
        });
        clientAlone = await make('client-alone', {
            ownerId: null,
            managers: [user],
        });
        clientWithSecondManager = await make('client-two-managers', {
            ownerId: null,
            managers: [user, other],
        });
        managedForLiveOwner = await make('managed-for-live-owner', {
            ownerId: other,
            managers: [user],
        });
        systemPayee = await make('system-payee', {
            ownerId: null,
            managers: [user],
            isSystem: true,
        });
        strangerBusiness = await make('stranger', { ownerId: other });
    });

    afterAll(async () => {
        await moduleRef.close();
        await mongo.stop();
    });

    const idsMatching = async (
        filter: FilterQuery<Business>
    ): Promise<string[]> => {
        const docs = await businessModel.find(filter, { _id: 1 }).lean().exec();
        return docs.map((d) => d._id.toString()).sort();
    };

    it('на видалення йдуть лише записи, за якими не лишається нікого', async () => {
        const found = await idsMatching(departingBusinessesFilter(user));

        expect(found).toEqual(
            [ownedAlone.toString(), clientAlone.toString()].sort()
        );
    });

    it('переживають видалення записи, за якими стоїть ще хтось', async () => {
        const found = await idsMatching(survivingBusinessesFilter(user));

        expect(found).toEqual(
            [
                ownedWithManager.toString(),
                clientWithSecondManager.toString(),
                managedForLiveOwner.toString(),
            ].sort()
        );
    });

    it('системний отримувач і чужий запис не потрапляють у жоден з наборів', async () => {
        const departing = await idsMatching(departingBusinessesFilter(user));
        const surviving = await idsMatching(survivingBusinessesFilter(user));
        const untouched = [systemPayee.toString(), strangerBusiness.toString()];

        for (const id of untouched) {
            expect(departing).not.toContain(id);
            expect(surviving).not.toContain(id);
        }
    });

    it('набори не перетинаються і разом покривають усе, до чого причетна людина', async () => {
        const departing = await idsMatching(departingBusinessesFilter(user));
        const surviving = await idsMatching(survivingBusinessesFilter(user));

        expect(departing.filter((id) => surviving.includes(id))).toHaveLength(
            0
        );
        expect(departing.length + surviving.length).toBe(5);
    });
});
