import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { Model } from 'mongoose';

import { ENV } from '../../config/env';
import { createReplSetMongo } from '../../test-utils/mongo';
import { GoogleSearchConsoleClient } from './google-search-console.client';
import { GuidesOrganicService } from './guides-organic.service';
import { Guide, GuideDocument, GuideSchema } from './schemas/guide.schema';

/** Мінімальний published-документ для перевірки зіставлення по URL. */
async function seedPublished(
    model: Model<GuideDocument>,
    slug: string,
    order: number
): Promise<void> {
    await model.create({
        slug,
        title: `Гайд ${slug}`,
        description: 'Опис для тесту органіки',
        authorId: 'tetiana-priadko',
        status: 'published',
        pillarSlug: null,
        order,
        blocks: [{ text: 'Текст' }],
        faq: [],
        datePublished: '2026-07-01',
        dateModified: '2026-07-01',
    });
}

describe('GuidesOrganicService', () => {
    let mongo: Awaited<ReturnType<typeof createReplSetMongo>>;
    let moduleRef: TestingModule;
    let service: GuidesOrganicService;
    let guideModel: Model<GuideDocument>;
    const gsc = { fetchPageClicks: jest.fn() };

    beforeAll(async () => {
        mongo = await createReplSetMongo();
        moduleRef = await Test.createTestingModule({
            imports: [
                MongooseModule.forRoot(mongo.uri),
                MongooseModule.forFeature([
                    { name: Guide.name, schema: GuideSchema },
                ]),
            ],
            providers: [
                GuidesOrganicService,
                { provide: GoogleSearchConsoleClient, useValue: gsc },
            ],
        }).compile();

        service = moduleRef.get(GuidesOrganicService);
        guideModel = moduleRef.get<Model<GuideDocument>>(
            getModelToken(Guide.name)
        );
    });

    afterEach(async () => {
        await guideModel.deleteMany({});
        jest.clearAllMocks();
    });

    afterAll(async () => {
        await moduleRef.close();
        await mongo.stop();
    });

    it('проставляє кліки опублікованим гайдам за збігом URL', async () => {
        await seedPublished(guideModel, 'guide-a', 1);
        await seedPublished(guideModel, 'guide-b', 2);

        // GSC повертає кліки лише для guide-a — guide-b має отримати 0.
        gsc.fetchPageClicks.mockResolvedValue(
            new Map([[`${ENV.WEB_URL}/guides/guide-a`, 42]])
        );

        const result = await service.syncNow();

        expect(result).toEqual({ updated: 2, totalClicks: 42 });
        const a = await guideModel.findOne({ slug: 'guide-a' }).exec();
        const b = await guideModel.findOne({ slug: 'guide-b' }).exec();
        expect(a?.organicClicks).toBe(42);
        expect(a?.organicSyncedAt).not.toBeNull();
        expect(b?.organicClicks).toBe(0);
        expect(b?.organicSyncedAt).not.toBeNull();
    });

    it('не чіпає чернетки і теми', async () => {
        await guideModel.create({
            slug: 'draft-guide',
            title: 'Чернетка',
            description: 'Опис чернетки для тесту',
            authorId: 'tetiana-priadko',
            status: 'draft',
            pillarSlug: null,
            order: 1,
            blocks: [{ text: 'Текст' }],
            faq: [],
        });
        gsc.fetchPageClicks.mockResolvedValue(new Map());

        const result = await service.syncNow();

        expect(result.updated).toBe(0);
        const draft = await guideModel.findOne({ slug: 'draft-guide' }).exec();
        expect(draft?.organicSyncedAt).toBeNull();
    });
});
