import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ZodValidationPipe } from 'nestjs-zod';
import * as supertest from 'supertest';
import { App } from 'supertest/types';
import { Model, Types } from 'mongoose';

// ─── Mock ENV (StorageModule → CloudflareR2Service reads R2 keys in ctor) ───
jest.mock('../src/config/env', () => ({
    ENV: {
        NODE_ENV: 'test',
        WEB_URL: 'https://finly.com.ua',
        REVALIDATE_SECRET: 'test-secret',
        GSC_SITE_URL: 'sc-domain:finly.com.ua',
        GSC_CLIENT_EMAIL: 'test-gsc@test.iam.gserviceaccount.com',
        GSC_PRIVATE_KEY:
            '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
        R2_ACCOUNT_ID: 'test-account',
        R2_ACCESS_KEY_ID: 'test-key-id',
        R2_SECRET_ACCESS_KEY: 'test-secret',
        R2_BUCKET_NAME: 'test-bucket',
        R2_PUBLIC_URL: 'https://media.test.local',
    },
}));

import { createReplSetMongo } from '../src/test-utils/mongo';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { JwtActiveGuard } from '../src/common/guards/jwt-active.guard';
import { GuidesModule } from '../src/modules/guides/guides.module';
import { GuidesRevalidationService } from '../src/modules/guides/guides-revalidation.service';
import {
    Guide,
    GuideDocument,
} from '../src/modules/guides/schemas/guide.schema';
import type { UpsertGuideRequest } from '@finly/types';

// Мутабельна роль — тести перемикають перед запитом, щоб перевірити AdminGuard.
const currentUser: { role: 'admin' | 'user' } = { role: 'admin' };

function guidePayload(
    overrides: Partial<UpsertGuideRequest> = {}
): UpsertGuideRequest {
    return {
        slug: 'yak-fop-pryimaty-oplatu',
        title: 'Як ФОП приймати оплату',
        description: 'Опис гайда для e2e-тесту прийому оплати',
        authorId: 'tetiana-priadko',
        pillarSlug: null,
        blocks: [{ text: 'Текст першого блоку гайда.' }],
        faq: [],
        ...overrides,
    };
}

describe('Guides E2E (Sprint 28)', () => {
    let app: INestApplication<App>;
    let mongo: Awaited<ReturnType<typeof createReplSetMongo>>;
    let guideModel: Model<GuideDocument>;

    beforeAll(async () => {
        mongo = await createReplSetMongo();

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [MongooseModule.forRoot(mongo.uri), GuidesModule],
        })
            // JwtActiveGuard підмінюється фейком, що інжектить поточного user-а
            // з заданою роллю. AdminGuard лишається справжнім — саме його
            // відмову для не-адміна перевіряє тест.
            .overrideGuard(JwtActiveGuard)
            .useValue({
                canActivate: (ctx: {
                    switchToHttp: () => {
                        getRequest: () => { user?: { role: string } };
                    };
                }) => {
                    ctx.switchToHttp().getRequest().user = {
                        role: currentUser.role,
                        _id: new Types.ObjectId(),
                    } as never;
                    return true;
                },
            })
            .overrideProvider(GuidesRevalidationService)
            .useValue({ revalidate: jest.fn().mockResolvedValue(undefined) })
            .compile();

        app = moduleFixture.createNestApplication();
        app.setGlobalPrefix('api');
        app.useGlobalPipes(new ZodValidationPipe());
        app.useGlobalFilters(new AllExceptionsFilter());
        await app.init();

        guideModel = moduleFixture.get(getModelToken(Guide.name));
    }, 60_000);

    afterAll(async () => {
        await app.close();
        await mongo.stop();
    });

    beforeEach(async () => {
        await guideModel.deleteMany({});
        currentUser.role = 'admin';
    });

    it('відхиляє admin-ендпоінт для не-адміна', async () => {
        currentUser.role = 'user';
        const res = await supertest(app.getHttpServer())
            .post('/api/admin/guides')
            .send(guidePayload());
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('ADMIN_ACCESS_REQUIRED');
    });

    it('happy-path: створення, публікація, публічне читання', async () => {
        const created = await supertest(app.getHttpServer())
            .post('/api/admin/guides')
            .send(guidePayload());
        expect(created.status).toBe(201);
        const id = created.body.data.id as string;
        expect(created.body.data.status).toBe('planned');

        // Чернетка публічно недоступна.
        const draftView = await supertest(app.getHttpServer()).get(
            '/api/guides/public/yak-fop-pryimaty-oplatu'
        );
        expect(draftView.status).toBe(404);

        const published = await supertest(app.getHttpServer()).post(
            `/api/admin/guides/${id}/publish`
        );
        expect(published.status).toBe(200);
        expect(published.body.data.status).toBe('published');

        const view = await supertest(app.getHttpServer()).get(
            '/api/guides/public/yak-fop-pryimaty-oplatu'
        );
        expect(view.status).toBe(200);
        expect(view.body.data.guide.title).toBe('Як ФОП приймати оплату');

        const tree = await supertest(app.getHttpServer()).get(
            '/api/guides/public'
        );
        expect(tree.status).toBe(200);
        expect(tree.body.data).toHaveLength(1);
    });

    it('reorder перевпорядковує список (route не перехоплений :id)', async () => {
        const a = await supertest(app.getHttpServer())
            .post('/api/admin/guides')
            .send(guidePayload({ slug: 'guide-a', title: 'Гайд A' }));
        const b = await supertest(app.getHttpServer())
            .post('/api/admin/guides')
            .send(guidePayload({ slug: 'guide-b', title: 'Гайд B' }));
        const idA = a.body.data.id as string;
        const idB = b.body.data.id as string;

        const res = await supertest(app.getHttpServer())
            .patch('/api/admin/guides/reorder')
            .send({ ids: [idB, idA] });
        expect(res.status).toBe(200);

        const list = await supertest(app.getHttpServer()).get(
            '/api/admin/guides'
        );
        expect(list.body.data.map((g: { slug: string }) => g.slug)).toEqual([
            'guide-b',
            'guide-a',
        ]);
    });

    it('забороняє видалення опублікованої статті', async () => {
        const created = await supertest(app.getHttpServer())
            .post('/api/admin/guides')
            .send(guidePayload());
        const id = created.body.data.id as string;
        await supertest(app.getHttpServer()).post(
            `/api/admin/guides/${id}/publish`
        );

        const del = await supertest(app.getHttpServer()).delete(
            `/api/admin/guides/${id}`
        );
        expect(del.status).toBe(409);
        expect(del.body.error.code).toBe('GUIDE_PUBLISHED_DELETE_FORBIDDEN');
    });
});
