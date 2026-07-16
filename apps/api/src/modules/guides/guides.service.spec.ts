import { MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { Model } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import type { UpsertGuideRequest } from '@finly/types';

import { createReplSetMongo } from '../../test-utils/mongo';
import { StorageService } from '../storage/storage.service';
import { GuidesRevalidationService } from './guides-revalidation.service';
import { GuidesService } from './guides.service';
import { Guide, GuideDocument, GuideSchema } from './schemas/guide.schema';

const AUTHOR_ID = 'tetiana-priadko';

function dto(overrides: Partial<UpsertGuideRequest> = {}): UpsertGuideRequest {
    return {
        slug: 'pillar-guide',
        title: 'Основний гайд',
        description: 'Опис основного гайда для тестів',
        authorId: AUTHOR_ID,
        pillarSlug: null,
        order: 1,
        blocks: [{ text: 'Текст блоку' }],
        faq: [],
        ...overrides,
    };
}

describe('GuidesService (Sprint 28, MongoMemoryReplSet)', () => {
    let mongo: Awaited<ReturnType<typeof createReplSetMongo>>;
    let moduleRef: TestingModule;
    let service: GuidesService;
    let guideModel: Model<GuideDocument>;
    const storage = { safeDeleteByUrl: jest.fn() };
    const revalidation = { revalidate: jest.fn() };

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
                GuidesService,
                { provide: StorageService, useValue: storage },
                { provide: GuidesRevalidationService, useValue: revalidation },
            ],
        }).compile();

        service = moduleRef.get(GuidesService);
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

    describe('create', () => {
        it('створює чернетку без дат публікації', async () => {
            const guide = await service.create(dto());
            expect(guide.status).toBe('draft');
            expect(guide.datePublished).toBeNull();
            expect(guide.dateModified).toBeNull();
        });

        it('відхиляє невідомого автора', async () => {
            await expect(
                service.create(dto({ authorId: 'nobody' }))
            ).rejects.toMatchObject({
                response: { code: 'VALIDATION_ERROR' },
            });
        });

        it('відхиляє cluster з неіснуючим pillar', async () => {
            await expect(
                service.create(
                    dto({ slug: 'cluster', pillarSlug: 'missing-pillar' })
                )
            ).rejects.toMatchObject({
                response: { code: 'GUIDE_PILLAR_INVALID' },
            });
        });

        it('відхиляє cluster, що вказує на інший cluster', async () => {
            const pillar = await service.create(dto());
            await service.create(
                dto({ slug: 'cluster-a', pillarSlug: pillar.slug, order: 1 })
            );
            await expect(
                service.create(
                    dto({
                        slug: 'cluster-b',
                        pillarSlug: 'cluster-a',
                        order: 2,
                    })
                )
            ).rejects.toMatchObject({
                response: { code: 'GUIDE_PILLAR_INVALID' },
            });
        });

        it('відхиляє дубль slug', async () => {
            await service.create(dto());
            await expect(service.create(dto())).rejects.toMatchObject({
                response: { code: 'SLUG_TAKEN' },
            });
        });
    });

    describe('publish / unpublish', () => {
        it('публікація ставить дати і тригерить перегенерацію', async () => {
            const draft = await service.create(dto());
            const published = await service.publish(draft.id);
            expect(published.status).toBe('published');
            expect(published.datePublished).not.toBeNull();
            expect(published.dateModified).not.toBeNull();
            expect(revalidation.revalidate).toHaveBeenCalledTimes(1);
        });

        it('зняття з публікації лишає datePublished (slug-lock тримається)', async () => {
            const draft = await service.create(dto());
            const published = await service.publish(draft.id);
            const firstPublishDate = published.datePublished;
            const back = await service.unpublish(draft.id);
            expect(back.status).toBe('draft');
            expect(back.datePublished).toBe(firstPublishDate);
        });
    });

    describe('update', () => {
        it('блокує зміну slug опублікованої статті', async () => {
            const draft = await service.create(dto());
            await service.publish(draft.id);
            await expect(
                service.update(draft.id, dto({ slug: 'new-slug' }))
            ).rejects.toMatchObject({
                response: { code: 'GUIDE_SLUG_LOCKED' },
            });
        });

        it('редагування опублікованої бампає dateModified і перегенеровує', async () => {
            const draft = await service.create(dto());
            await service.publish(draft.id);
            jest.clearAllMocks();
            const updated = await service.update(
                draft.id,
                dto({ title: 'Оновлена назва' })
            );
            expect(updated.title).toBe('Оновлена назва');
            expect(updated.dateModified).not.toBeNull();
            expect(revalidation.revalidate).toHaveBeenCalledTimes(1);
        });

        it('перейменування чернетки-pillar каскадно оновлює cluster-и', async () => {
            const pillar = await service.create(dto());
            await service.create(
                dto({ slug: 'cluster-a', pillarSlug: pillar.slug })
            );
            await service.update(pillar.id, dto({ slug: 'renamed-pillar' }));
            const cluster = await guideModel
                .findOne({ slug: 'cluster-a' })
                .exec();
            expect(cluster?.pillarSlug).toBe('renamed-pillar');
        });

        it('забороняє перетворити pillar на cluster, поки має cluster-и', async () => {
            const pillar = await service.create(dto());
            const other = await service.create(
                dto({ slug: 'other-pillar', order: 2 })
            );
            await service.create(
                dto({ slug: 'cluster-a', pillarSlug: pillar.slug })
            );
            await expect(
                service.update(
                    pillar.id,
                    dto({ slug: pillar.slug, pillarSlug: other.slug })
                )
            ).rejects.toMatchObject({
                response: { code: 'GUIDE_HAS_CLUSTERS' },
            });
        });
    });

    describe('delete', () => {
        it('забороняє видалення опублікованої статті', async () => {
            const draft = await service.create(dto());
            await service.publish(draft.id);
            await expect(service.delete(draft.id)).rejects.toMatchObject({
                response: { code: 'GUIDE_PUBLISHED_DELETE_FORBIDDEN' },
            });
        });

        it('видаляє чернетку і прибирає її картинки з R2', async () => {
            const draft = await service.create(
                dto({
                    blocks: [
                        {
                            text: 'Блок',
                            image: {
                                src: 'https://media.test.local/guide-images/x.webp',
                                alt: 'Опис зображення',
                                width: 800,
                                height: 600,
                            },
                        },
                    ],
                })
            );
            await service.delete(draft.id);
            expect(await guideModel.findById(draft.id).exec()).toBeNull();
            expect(storage.safeDeleteByUrl).toHaveBeenCalledWith(
                'https://media.test.local/guide-images/x.webp'
            );
        });

        it('забороняє видалення pillar із cluster-ами', async () => {
            const pillar = await service.create(dto());
            await service.create(
                dto({ slug: 'cluster-a', pillarSlug: pillar.slug })
            );
            await expect(service.delete(pillar.id)).rejects.toMatchObject({
                response: { code: 'GUIDE_HAS_CLUSTERS' },
            });
        });
    });

    describe('public reads', () => {
        it('дерево і slugs містять лише опубліковане', async () => {
            const pillar = await service.create(dto());
            await service.publish(pillar.id);
            await service.create(
                dto({ slug: 'draft-cluster', pillarSlug: pillar.slug })
            );

            const tree = await service.getPublicTree();
            expect(tree).toHaveLength(1);
            expect(tree[0].pillar.slug).toBe(pillar.slug);
            expect(tree[0].clusters).toHaveLength(0);

            const slugs = await service.getPublishedSlugs();
            expect(slugs).toEqual([pillar.slug]);
        });

        it('view cluster повертає pillar і related', async () => {
            const pillar = await service.create(dto());
            await service.publish(pillar.id);
            const cluster = await service.create(
                dto({ slug: 'cluster-a', pillarSlug: pillar.slug })
            );
            await service.publish(cluster.id);

            const view = await service.getPublicView('cluster-a');
            expect(view?.guide.slug).toBe('cluster-a');
            expect(view?.pillar?.slug).toBe(pillar.slug);
            expect(view?.related.map((r) => r.slug)).toContain(pillar.slug);
        });

        it('неопублікована стаття не віддається публічно', async () => {
            await service.create(dto());
            expect(await service.getPublicView('pillar-guide')).toBeNull();
        });
    });
});
