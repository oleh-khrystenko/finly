import { Test, TestingModule } from '@nestjs/testing';
import { Global, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as supertest from 'supertest';
import { App } from 'supertest/types';
import { ZodValidationPipe } from 'nestjs-zod';
import { Model, Types } from 'mongoose';

import { createReplSetMongo } from '../src/test-utils/mongo';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { REDIS_CLIENT } from '../src/common/modules/redis.module';
import { RedisCounterService } from '../src/common/services/redis-counter.service';
import { AuthModule } from '../src/modules/auth/auth.module';
import { BusinessesModule } from '../src/modules/businesses/businesses.module';
import { EmailModule } from '../src/modules/email/email.module';
import { EmailService } from '../src/modules/email/email.service';
import { InvoicesModule } from '../src/modules/invoices/invoices.module';
import { QrModule } from '../src/modules/qr/qr.module';
import { StorageModule } from '../src/modules/storage/storage.module';
import { UsersModule } from '../src/modules/users/users.module';
import { User, UserDocument } from '../src/modules/users/schemas/user.schema';
import {
    Business,
    BusinessDocument,
} from '../src/modules/businesses/schemas/business.schema';
import {
    Invoice,
    InvoiceDocument,
} from '../src/modules/invoices/schemas/invoice.schema';
import { CURRENT_TERMS_VERSION } from '@finly/types';

// ─── Mock ENV ───

jest.mock('../src/config/env', () => ({
    ENV: {
        NODE_ENV: 'test',
        PORT: '4000',
        WEB_URL: 'https://finly.com.ua',
        PAY_PUBLIC_URL: 'https://pay.finly.com.ua',
        MONGODB_URI: 'overridden-by-MongoMemoryReplSet',
        REDIS_URL: 'redis://mock',
        JWT_ACCESS_SECRET: 'e2e-access-secret-must-be-long-enough',
        JWT_REFRESH_SECRET: 'e2e-refresh-secret-must-be-long-enough',
        GOOGLE_CLIENT_ID: 'test-id.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'GOCSPX-test',
        GOOGLE_CALLBACK_URL: 'http://localhost:4000/api/auth/google/callback',
        RESEND_API_KEY: 're_test',
        RESEND_FROM_EMAIL: 'Finly <test@test.com>',
        STRIPE_SECRET_KEY: 'sk_test',
        STRIPE_WEBHOOK_SECRET: 'whsec_test',
        AUTH_LOCKOUT_THRESHOLDS: '5:1,10:5,20:15',
        AUTH_LOGIN_ATTEMPTS_TTL_MIN: 15,
        AUTH_MAGIC_LINK_TTL_MIN: 15,
        AUTH_MAGIC_LINK_RATE_LIMIT: 3,
        AUTH_MAGIC_LINK_RATE_WINDOW_MIN: 15,
        AUTH_MAGIC_LINK_DEDUP_SEC: 60,
        ACCOUNT_DELETION_GRACE_DAYS: 30,
        AUTH_PASSWORD_MIN_LENGTH: 8,
        R2_ACCOUNT_ID: 'test-account',
        R2_ACCESS_KEY_ID: 'test-key-id',
        R2_SECRET_ACCESS_KEY: 'test-secret',
        R2_BUCKET_NAME: 'test-bucket',
        R2_PUBLIC_URL: 'https://media.test.local',
    },
    parseLockoutThresholds: (raw: string) =>
        raw.split(',').map((entry: string) => {
            const [attempts, blockMin] = entry.split(':').map(Number);
            return { attempts, blockMin };
        }),
}));

// ─── In-test Redis-mock module ───

@Global()
@Module({
    providers: [
        {
            provide: REDIS_CLIENT,
            useFactory: () => createRedisMock(),
        },
        {
            provide: RedisCounterService,
            useValue: {
                incrementFixed: jest.fn(async () => 1),
                incrementSliding: jest.fn(async () => 1),
            },
        },
    ],
    exports: [REDIS_CLIENT, RedisCounterService],
})
class TestRedisModule {}

function createRedisMock() {
    const store = new Map<string, string>();
    return {
        async get(key: string) {
            return store.get(key) ?? null;
        },
        async set(key: string, value: string) {
            store.set(key, value);
            return 'OK';
        },
        async del(key: string) {
            store.delete(key);
            return 1;
        },
        async incr(key: string) {
            const n = (parseInt(store.get(key) ?? '0', 10) || 0) + 1;
            store.set(key, String(n));
            return n;
        },
        async expire() {
            return 1;
        },
        async smembers() {
            return [];
        },
        async srem() {
            return 0;
        },
        async getdel(key: string) {
            const val = store.get(key) ?? null;
            if (val !== null) store.delete(key);
            return val;
        },
        pipeline() {
            const pipe = {
                set() {
                    return pipe;
                },
                del() {
                    return pipe;
                },
                incr() {
                    return pipe;
                },
                expire() {
                    return pipe;
                },
                async exec() {
                    return [];
                },
            };
            return pipe;
        },
        eval() {
            return 0;
        },
    };
}

// ─── Fixtures ───

const VALID_IBAN = 'UA213223130000026007233566001';
const VALID_TAX_ID = '1234567899';

const VALID_BUSINESS_PAYLOAD = {
    type: 'fop',
    name: 'ФОП Іваненко',
    requisites: { iban: VALID_IBAN, taxId: VALID_TAX_ID },
    taxationSystem: 'simplified-3',
    isVatPayer: false,
    paymentPurposeTemplate: 'Оплата за послуги',
    acceptedBanks: ['privatbank', 'monobank'],
};

// ─── Test ───

/**
 * Sprint 4 §4.2 e2e — повний flow CRUD інвойсу як ФОП у бізнесі +
 * cross-business access deny + cascade-delete (через `MongoMemoryReplSet`,
 * як цього вимагає §SP-5: cascade ходить через `withTransaction`).
 */
describe('Invoices E2E (Sprint 4 §4.2)', () => {
    let app: INestApplication<App>;
    let mongo: Awaited<ReturnType<typeof createReplSetMongo>>;
    let userModel: Model<UserDocument>;
    let businessModel: Model<BusinessDocument>;
    let invoiceModel: Model<InvoiceDocument>;
    let jwtService: JwtService;

    beforeAll(async () => {
        // Replica-set обов'язковий для cascade-delete (§SP-5). Standalone
        // MongoMemoryServer падає на withTransaction → cascade-tests fail.
        mongo = await createReplSetMongo();

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true }),
                ThrottlerModule.forRoot({
                    throttlers: [{ ttl: 60000, limit: 600 }],
                }),
                MongooseModule.forRoot(mongo.uri),
                TestRedisModule,
                AuthModule,
                EmailModule,
                UsersModule,
                StorageModule,
                BusinessesModule,
                InvoicesModule,
                QrModule,
            ],
            providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
        })
            .overrideProvider(EmailService)
            .useValue({
                sendMagicLink: jest.fn().mockResolvedValue(undefined),
                sendDeletionConfirmation: jest
                    .fn()
                    .mockResolvedValue(undefined),
            })
            .compile();

        app = moduleFixture.createNestApplication();
        app.setGlobalPrefix('api');
        app.useGlobalPipes(new ZodValidationPipe());
        app.useGlobalFilters(new AllExceptionsFilter());
        await app.init();

        userModel = moduleFixture.get<Model<UserDocument>>(
            getModelToken(User.name)
        );
        businessModel = moduleFixture.get<Model<BusinessDocument>>(
            getModelToken(Business.name)
        );
        invoiceModel = moduleFixture.get<Model<InvoiceDocument>>(
            getModelToken(Invoice.name)
        );
        jwtService = moduleFixture.get(JwtService);
    }, 60_000);

    afterAll(async () => {
        await app.close();
        await mongo.stop();
    });

    beforeEach(async () => {
        await userModel.deleteMany({});
        await businessModel.deleteMany({});
        await invoiceModel.deleteMany({});
    });

    // ─── Helpers ───

    async function createUser(): Promise<UserDocument> {
        return userModel.create({
            email: `user-${new Types.ObjectId().toString()}@test.com`,
            profile: {
                firstName: 'Test',
                lastName: 'User',
                acceptedTermsVersion: CURRENT_TERMS_VERSION,
            },
            executions: { balance: 0, freeReportUsed: false },
            worksAsBookkeeper: false,
        });
    }

    function bearerFor(user: UserDocument): string {
        return `Bearer ${jwtService.sign(
            { sub: user._id.toString(), email: user.email },
            { secret: 'e2e-access-secret-must-be-long-enough' }
        )}`;
    }

    async function createBusinessFor(user: UserDocument): Promise<string> {
        const res = await supertest(app.getHttpServer())
            .post('/api/businesses/me')
            .set('Authorization', bearerFor(user))
            .send(VALID_BUSINESS_PAYLOAD);
        return (res.body as { data: { slug: string } }).data.slug;
    }

    // ─── POST /businesses/me/:slug/invoices ───

    describe('POST /businesses/me/:slug/invoices', () => {
        it('створює invoice з пресетом simple — 201 + slug "inv-001-..." + counter-fields', async () => {
            const user = await createUser();
            const slug = await createBusinessFor(user);

            const res = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${slug}/invoices`)
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 150000,
                    amountLocked: true,
                    paymentPurpose: 'Оплата за консультацію',
                    validUntil: null,
                    slugInput: { kind: 'preset', preset: 'simple' },
                })
                .expect(201);

            const body = res.body as {
                data: {
                    slug: string;
                    slugPreset: string;
                    slugCounterScope: string;
                    slugCounter: number;
                    amount: number;
                    amountLocked: boolean;
                };
            };
            expect(body.data.slug).toMatch(/^inv-001-[A-Za-z0-9]{8}$/);
            expect(body.data.slugPreset).toBe('simple');
            expect(body.data.slugCounterScope).toBe('simple');
            expect(body.data.slugCounter).toBe(1);
            expect(body.data.amount).toBe(150000);
            expect(body.data.amountLocked).toBe(true);
        });

        it('створює signage-mode invoice (amount=null, amountLocked=false)', async () => {
            const user = await createUser();
            const slug = await createBusinessFor(user);

            const res = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${slug}/invoices`)
                .set('Authorization', bearerFor(user))
                .send({
                    amount: null,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                })
                .expect(201);

            const body = res.body as {
                data: { amount: null; amountLocked: boolean; slug: string };
            };
            expect(body.data.amount).toBeNull();
            expect(body.data.amountLocked).toBe(false);
            expect(body.data.slug).toMatch(/^[A-Za-z0-9]{8}$/);
        });

        it('reject coupled violation (amount=null + amountLocked=true) — 400', async () => {
            const user = await createUser();
            const slug = await createBusinessFor(user);

            const res = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${slug}/invoices`)
                .set('Authorization', bearerFor(user))
                .send({
                    amount: null,
                    amountLocked: true,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                })
                .expect(400);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'VALIDATION_ERROR'
            );
        });

        it('reject explicit з invalid humanPart (uppercase) — 400', async () => {
            const user = await createUser();
            const slug = await createBusinessFor(user);

            await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${slug}/invoices`)
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 150000,
                    amountLocked: true,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'explicit', humanPart: 'ORDER-001' },
                })
                .expect(400);
        });

        it('5 послідовних simple-інвойсів — counter monotonic 001..005', async () => {
            const user = await createUser();
            const slug = await createBusinessFor(user);

            for (let i = 1; i <= 5; i++) {
                const res = await supertest(app.getHttpServer())
                    .post(`/api/businesses/me/${slug}/invoices`)
                    .set('Authorization', bearerFor(user))
                    .send({
                        amount: 100000,
                        amountLocked: false,
                        paymentPurpose: null,
                        validUntil: null,
                        slugInput: { kind: 'preset', preset: 'simple' },
                    })
                    .expect(201);
                const body = res.body as { data: { slugCounter: number } };
                expect(body.data.slugCounter).toBe(i);
            }
        });

        it('access-deny: чужий бізнес → 403 BUSINESS_ACCESS_DENIED', async () => {
            // BusinessAccessGuard: user → бізнес знайдено, але user НЕ є
            // owner/manager → 403 (Sprint 3 §3.10 patterна — у cabinet enumeration
            // не є ризиком, чесний 403 кращий UX).
            const owner = await createUser();
            const slug = await createBusinessFor(owner);
            const intruder = await createUser();

            const res = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${slug}/invoices`)
                .set('Authorization', bearerFor(intruder))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                })
                .expect(403);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'BUSINESS_ACCESS_DENIED'
            );
        });
    });

    // ─── GET list ───

    describe('GET /businesses/me/:slug/invoices', () => {
        it('paginated list з total, page, limit', async () => {
            const user = await createUser();
            const slug = await createBusinessFor(user);
            // створимо 3 інвойси
            for (let i = 0; i < 3; i++) {
                await supertest(app.getHttpServer())
                    .post(`/api/businesses/me/${slug}/invoices`)
                    .set('Authorization', bearerFor(user))
                    .send({
                        amount: 100,
                        amountLocked: false,
                        paymentPurpose: null,
                        validUntil: null,
                        slugInput: { kind: 'random' },
                    });
            }

            const res = await supertest(app.getHttpServer())
                .get(`/api/businesses/me/${slug}/invoices?page=1&limit=2`)
                .set('Authorization', bearerFor(user))
                .expect(200);

            const body = res.body as {
                data: {
                    items: unknown[];
                    total: number;
                    page: number;
                    limit: number;
                };
            };
            expect(body.data.items).toHaveLength(2);
            expect(body.data.total).toBe(3);
            expect(body.data.page).toBe(1);
            expect(body.data.limit).toBe(2);
        });

        it('default page=1 limit=10', async () => {
            const user = await createUser();
            const slug = await createBusinessFor(user);

            const res = await supertest(app.getHttpServer())
                .get(`/api/businesses/me/${slug}/invoices`)
                .set('Authorization', bearerFor(user))
                .expect(200);
            const body = res.body as {
                data: { page: number; limit: number };
            };
            expect(body.data.page).toBe(1);
            expect(body.data.limit).toBe(10);
        });
    });

    // ─── GET single ───

    describe('GET /businesses/me/:slug/invoices/:invoiceSlug', () => {
        it('повертає invoice по slug — 200', async () => {
            const user = await createUser();
            const slug = await createBusinessFor(user);
            const create = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${slug}/invoices`)
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                });
            const invoiceSlug = (create.body as { data: { slug: string } }).data
                .slug;

            const res = await supertest(app.getHttpServer())
                .get(`/api/businesses/me/${slug}/invoices/${invoiceSlug}`)
                .set('Authorization', bearerFor(user))
                .expect(200);
            expect((res.body as { data: { slug: string } }).data.slug).toBe(
                invoiceSlug
            );
        });

        it('404 INVOICE_NOT_FOUND для неіснуючого slug', async () => {
            const user = await createUser();
            const slug = await createBusinessFor(user);
            const res = await supertest(app.getHttpServer())
                .get(`/api/businesses/me/${slug}/invoices/missing-aaaaaaaa`)
                .set('Authorization', bearerFor(user))
                .expect(404);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'INVOICE_NOT_FOUND'
            );
        });

        it('case-sensitive slug lookup (SP-8)', async () => {
            const user = await createUser();
            const slug = await createBusinessFor(user);
            const create = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${slug}/invoices`)
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: {
                        kind: 'explicit',
                        humanPart: 'order-2026',
                    },
                });
            const invoiceSlug = (create.body as { data: { slug: string } }).data
                .slug;

            // Uppercase варіант → 404, бо case-sensitive
            await supertest(app.getHttpServer())
                .get(
                    `/api/businesses/me/${slug}/invoices/${invoiceSlug.toUpperCase()}`
                )
                .set('Authorization', bearerFor(user))
                .expect(404);
        });
    });

    // ─── PATCH ───

    describe('PATCH /businesses/me/:slug/invoices/:invoiceSlug', () => {
        it('inline-edit paymentPurpose — 200', async () => {
            const user = await createUser();
            const slug = await createBusinessFor(user);
            const create = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${slug}/invoices`)
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: 'Old',
                    validUntil: null,
                    slugInput: { kind: 'random' },
                });
            const invoiceSlug = (create.body as { data: { slug: string } }).data
                .slug;

            const res = await supertest(app.getHttpServer())
                .patch(`/api/businesses/me/${slug}/invoices/${invoiceSlug}`)
                .set('Authorization', bearerFor(user))
                .send({ paymentPurpose: 'New purpose' })
                .expect(200);
            expect(
                (res.body as { data: { paymentPurpose: string } }).data
                    .paymentPurpose
            ).toBe('New purpose');
        });

        it('reject спробу змінити slug через PATCH — 400 (slug-immutability via .strict())', async () => {
            const user = await createUser();
            const slug = await createBusinessFor(user);
            const create = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${slug}/invoices`)
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                });
            const invoiceSlug = (create.body as { data: { slug: string } }).data
                .slug;

            await supertest(app.getHttpServer())
                .patch(`/api/businesses/me/${slug}/invoices/${invoiceSlug}`)
                .set('Authorization', bearerFor(user))
                .send({ slug: 'evil-vanity' })
                .expect(400);
        });

        it.each(['slugPreset', 'businessId', 'createdAt', 'slugCounter'])(
            'reject спробу змінити %s через PATCH (.strict())',
            async (key) => {
                const user = await createUser();
                const slug = await createBusinessFor(user);
                const create = await supertest(app.getHttpServer())
                    .post(`/api/businesses/me/${slug}/invoices`)
                    .set('Authorization', bearerFor(user))
                    .send({
                        amount: 100,
                        amountLocked: false,
                        paymentPurpose: null,
                        validUntil: null,
                        slugInput: { kind: 'random' },
                    });
                const invoiceSlug = (create.body as { data: { slug: string } })
                    .data.slug;

                await supertest(app.getHttpServer())
                    .patch(`/api/businesses/me/${slug}/invoices/${invoiceSlug}`)
                    .set('Authorization', bearerFor(user))
                    .send({ [key]: 'evil' })
                    .expect(400);
            }
        );

        it('coupled cross-field amount=null + amountLocked=true (PATCH тільки amountLocked) — 400 INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT', async () => {
            const user = await createUser();
            const slug = await createBusinessFor(user);
            const create = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${slug}/invoices`)
                .set('Authorization', bearerFor(user))
                .send({
                    amount: null,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                });
            const invoiceSlug = (create.body as { data: { slug: string } }).data
                .slug;

            const res = await supertest(app.getHttpServer())
                .patch(`/api/businesses/me/${slug}/invoices/${invoiceSlug}`)
                .set('Authorization', bearerFor(user))
                .send({ amountLocked: true })
                .expect(400);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT'
            );
        });
    });

    // ─── DELETE ───

    describe('DELETE /businesses/me/:slug/invoices/:invoiceSlug', () => {
        it('hard-delete — 200, наступний GET → 404', async () => {
            const user = await createUser();
            const slug = await createBusinessFor(user);
            const create = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${slug}/invoices`)
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                });
            const invoiceSlug = (create.body as { data: { slug: string } }).data
                .slug;

            await supertest(app.getHttpServer())
                .delete(`/api/businesses/me/${slug}/invoices/${invoiceSlug}`)
                .set('Authorization', bearerFor(user))
                .expect(200);

            await supertest(app.getHttpServer())
                .get(`/api/businesses/me/${slug}/invoices/${invoiceSlug}`)
                .set('Authorization', bearerFor(user))
                .expect(404);
        });
    });

    // ─── Cascade-delete: GET /businesses/me/:slug + DELETE ───

    describe('Cascade-delete (Sprint 4 §SP-5)', () => {
        it('GET /businesses/me/:slug повертає invoicesCount', async () => {
            const user = await createUser();
            const slug = await createBusinessFor(user);

            // Створюємо 2 інвойси
            for (let i = 0; i < 2; i++) {
                await supertest(app.getHttpServer())
                    .post(`/api/businesses/me/${slug}/invoices`)
                    .set('Authorization', bearerFor(user))
                    .send({
                        amount: 100,
                        amountLocked: false,
                        paymentPurpose: null,
                        validUntil: null,
                        slugInput: { kind: 'random' },
                    });
            }

            const res = await supertest(app.getHttpServer())
                .get(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .expect(200);
            const body = res.body as {
                data: { invoicesCount: number };
            };
            expect(body.data.invoicesCount).toBe(2);
        });

        it('DELETE business → cascade видалення усіх invoices + response.affectedInvoices', async () => {
            const user = await createUser();
            const slug = await createBusinessFor(user);

            // 3 інвойси
            for (let i = 0; i < 3; i++) {
                await supertest(app.getHttpServer())
                    .post(`/api/businesses/me/${slug}/invoices`)
                    .set('Authorization', bearerFor(user))
                    .send({
                        amount: 100,
                        amountLocked: false,
                        paymentPurpose: null,
                        validUntil: null,
                        slugInput: { kind: 'random' },
                    });
            }

            const res = await supertest(app.getHttpServer())
                .delete(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .expect(200);
            expect(
                (res.body as { data: { affectedInvoices: number } }).data
                    .affectedInvoices
            ).toBe(3);

            // Бізнес видалений
            await supertest(app.getHttpServer())
                .get(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .expect(404);

            // Усі інвойси теж видалені
            const remaining = await invoiceModel.countDocuments({});
            expect(remaining).toBe(0);
        });

        it('DELETE business без інвойсів → affectedInvoices=0', async () => {
            const user = await createUser();
            const slug = await createBusinessFor(user);

            const res = await supertest(app.getHttpServer())
                .delete(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .expect(200);
            expect(
                (res.body as { data: { affectedInvoices: number } }).data
                    .affectedInvoices
            ).toBe(0);
        });

        it('cross-business cascade isolation: інвойси іншого бізнесу не зачеплені', async () => {
            const user = await createUser();
            const slugA = await createBusinessFor(user);
            // Створюємо другий бізнес — потребує іншого URL-shape, тому через
            // DB-rename. Простіше: створюємо ще одного user і його бізнес.
            const userB = await createUser();
            const slugB = await createBusinessFor(userB);

            await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${slugA}/invoices`)
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                });
            await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${slugB}/invoices`)
                .set('Authorization', bearerFor(userB))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                });

            await supertest(app.getHttpServer())
                .delete(`/api/businesses/me/${slugA}`)
                .set('Authorization', bearerFor(user))
                .expect(200);

            // Інвойс бізнесу B все ще там
            const remaining = await invoiceModel.countDocuments({});
            expect(remaining).toBe(1);
        });
    });
});
