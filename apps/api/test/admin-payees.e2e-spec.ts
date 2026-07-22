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
import { CURRENT_TERMS_VERSION } from '@finly/types';

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
        BILLING_BRAND_ENABLED: true,
        BILLING_DOCUMENTS_ENABLED: false,
        BILLING_GRID: {
            currency: 'UAH',
            brand: { pricePerBusiness: 4900 },
            documents: {
                tiers: [
                    { size: 1, priceAmount: 29900, monthlyCredits: 1000 },
                    { size: 5, priceAmount: 149500, monthlyCredits: 5000 },
                ],
                storageGbPerBusiness: 5,
                storageRentCreditsPerGb: 10,
                creditPacks: [{ credits: 500, priceAmount: 15000 }],
                lowBalanceThreshold: 200,
                criticalBalanceThreshold: 100,
            },
        },
    },
    parseLockoutThresholds: (raw: string) =>
        raw.split(',').map((entry: string) => {
            const [attempts, blockMin] = entry.split(':').map(Number);
            return { attempts, blockMin };
        }),
}));

import { createReplSetMongo } from '../src/test-utils/mongo';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { REDIS_CLIENT } from '../src/common/modules/redis.module';
import { RedisCounterService } from '../src/common/services/redis-counter.service';
import { RedisLockService } from '../src/common/services/redis-lock.service';
// Import order matters: AuthModule ↔ UsersModule ↔ StorageModule —
// pre-existing JS-cycle (`CLAUDE.md` Known Complexities).
import { AuthModule } from '../src/modules/auth/auth.module';
import { EmailModule } from '../src/modules/email/email.module';
import { EmailService } from '../src/modules/email/email.service';
import { StorageModule } from '../src/modules/storage/storage.module';
import { UsersModule } from '../src/modules/users/users.module';
import { User, UserDocument } from '../src/modules/users/schemas/user.schema';
import { AccountsModule } from '../src/modules/accounts/accounts.module';
import {
    Account,
    AccountDocument,
} from '../src/modules/accounts/schemas/account.schema';
import { AdminPayeesModule } from '../src/modules/admin-payees/admin-payees.module';
import { BusinessesModule } from '../src/modules/businesses/businesses.module';
import {
    Business,
    BusinessDocument,
} from '../src/modules/businesses/schemas/business.schema';
import { QrModule } from '../src/modules/qr/qr.module';

@Global()
@Module({
    providers: [
        { provide: REDIS_CLIENT, useFactory: () => createRedisMock() },
        {
            provide: RedisCounterService,
            useValue: {
                incrementFixed: jest.fn(async () => 1),
                incrementSliding: jest.fn(async () => 1),
            },
        },
        {
            provide: RedisLockService,
            useValue: {
                withLock: async (
                    _key: string,
                    _ttlMs: number,
                    fn: () => Promise<unknown>
                ) => fn(),
            },
        },
    ],
    exports: [REDIS_CLIENT, RedisCounterService, RedisLockService],
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
                set: () => pipe,
                del: () => pipe,
                incr: () => pipe,
                expire: () => pipe,
                exec: async () => [],
            };
            return pipe;
        },
        eval() {
            return 0;
        },
    };
}

const SYSTEM_IBAN = 'UA213223130000026007233566001';
const SYSTEM_IBAN_SECOND = 'UA273052992990004149497786452';
const USER_IBAN = 'UA903052992990004149123456789';

/** Шаблон з відомими маркерами — легальний ЛИШЕ у системного отримувача. */
const MARKER_TEMPLATE = 'Єдиний внесок {taxId} за {period}';

const SYSTEM_PAYEE_PAYLOAD = {
    type: 'organization',
    name: 'ГУ ДПС у Київській області',
    taxId: '43968079',
    paymentPurposeTemplate: MARKER_TEMPLATE,
    catalogCategory: 'state',
};

const USER_BUSINESS_PAYLOAD = {
    type: 'fop',
    name: 'ФОП Іваненко',
    taxId: '1234567899',
    taxationSystem: 'simplified-3',
    isVatPayer: false,
    paymentPurposeTemplate: 'Оплата за послуги',
};

/**
 * Повна карта адмін-поверхні Sprint 29. Guard-chain (`JwtActiveGuard` →
 * `AdminGuard`) стоїть на класі обох контролерів, тож перевіряємо КОЖЕН роут:
 * новий метод, доданий без guard-а, провалить цей масив, а не пройде тихо.
 * Slug-и тут навмисно неіснуючі — guard відпрацьовує до handler-а, тож 401/403
 * не залежать від даних.
 */
const ADMIN_ROUTES: ReadonlyArray<{
    method: 'get' | 'post' | 'patch' | 'delete';
    path: string;
}> = [
    { method: 'get', path: '/api/admin/payees' },
    { method: 'post', path: '/api/admin/payees' },
    { method: 'get', path: '/api/admin/payees/dps-kyiv' },
    { method: 'patch', path: '/api/admin/payees/dps-kyiv' },
    { method: 'delete', path: '/api/admin/payees/dps-kyiv' },
    { method: 'patch', path: '/api/admin/payees/dps-kyiv/catalog-visibility' },
    { method: 'post', path: '/api/admin/payees/dps-kyiv/accounts' },
    { method: 'patch', path: '/api/admin/payees/dps-kyiv/accounts/esv-2026' },
    {
        method: 'patch',
        path: '/api/admin/payees/dps-kyiv/accounts/esv-2026/catalog-visibility',
    },
    { method: 'delete', path: '/api/admin/payees/dps-kyiv/accounts/esv-2026' },
    { method: 'get', path: '/api/admin/publicity' },
    { method: 'post', path: '/api/admin/publicity/ivanenko/approve' },
    { method: 'post', path: '/api/admin/publicity/ivanenko/reject' },
];

describe('Admin payees E2E (Sprint 29)', () => {
    let app: INestApplication<App>;
    let mongo: Awaited<ReturnType<typeof createReplSetMongo>>;
    let userModel: Model<UserDocument>;
    let businessModel: Model<BusinessDocument>;
    let accountModel: Model<AccountDocument>;
    let jwtService: JwtService;

    beforeAll(async () => {
        mongo = await createReplSetMongo();

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true }),
                ThrottlerModule.forRoot({
                    throttlers: [{ ttl: 60000, limit: 5000 }],
                }),
                MongooseModule.forRoot(mongo.uri),
                TestRedisModule,
                AuthModule,
                EmailModule,
                UsersModule,
                StorageModule,
                BusinessesModule,
                AccountsModule,
                QrModule,
                AdminPayeesModule,
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

        userModel = moduleFixture.get(getModelToken(User.name));
        businessModel = moduleFixture.get(getModelToken(Business.name));
        accountModel = moduleFixture.get(getModelToken(Account.name));
        jwtService = moduleFixture.get(JwtService);
    }, 60_000);

    afterAll(async () => {
        await app.close();
        await mongo.stop();
    });

    beforeEach(async () => {
        await userModel.deleteMany({});
        await businessModel.deleteMany({});
        await accountModel.deleteMany({});
    });

    async function createUser(role: 'admin' | 'user'): Promise<UserDocument> {
        return userModel.create({
            email: `${role}-${new Types.ObjectId().toString()}@test.com`,
            role,
            profile: {
                firstName: 'Test',
                lastName: 'User',
                acceptedTermsVersion: CURRENT_TERMS_VERSION,
            },
            worksAsBookkeeper: false,
        });
    }

    function bearerFor(user: UserDocument): string {
        return `Bearer ${jwtService.sign(
            { sub: user._id.toString(), email: user.email },
            { secret: 'e2e-access-secret-must-be-long-enough' }
        )}`;
    }

    function request(
        method: 'get' | 'post' | 'patch' | 'delete',
        path: string
    ) {
        return supertest(app.getHttpServer())[method](path);
    }

    async function createSystemPayee(
        admin: UserDocument,
        overrides: Record<string, unknown> = {}
    ): Promise<string> {
        const res = await request('post', '/api/admin/payees')
            .set('Authorization', bearerFor(admin))
            .send({ ...SYSTEM_PAYEE_PAYLOAD, ...overrides })
            .expect(201);
        return (res.body as { data: { slug: string } }).data.slug;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Guard-chain: DoD §102 «адмін-ендпоінти недоступні без ролі admin».
    // ─────────────────────────────────────────────────────────────────────

    describe('guard-chain (JwtActiveGuard → AdminGuard)', () => {
        it.each(ADMIN_ROUTES)(
            'без автентифікації: $method $path → 401',
            async ({ method, path }) => {
                const res = await request(method, path).send({});
                expect(res.status).toBe(401);
                expect(
                    (res.body as { error: { code: string } }).error.code
                ).toBe('UNAUTHORIZED');
            }
        );

        it.each(ADMIN_ROUTES)(
            'роль user: $method $path → 403 ADMIN_ACCESS_REQUIRED',
            async ({ method, path }) => {
                const user = await createUser('user');
                const res = await request(method, path)
                    .set('Authorization', bearerFor(user))
                    .send({});
                expect(res.status).toBe(403);
                expect(
                    (res.body as { error: { code: string } }).error.code
                ).toBe('ADMIN_ACCESS_REQUIRED');
            }
        );

        it('невалідний JWT → 401 (guard не пропускає підроблений токен)', async () => {
            const res = await request('get', '/api/admin/payees').set(
                'Authorization',
                'Bearer not-a-real-token'
            );
            expect(res.status).toBe(401);
        });

        it('роль admin проходить guard-chain на кожному роуті (не 401/403)', async () => {
            const admin = await createUser('admin');

            // Системний отримувач + його реквізити, щоб кожен slug-роут мав
            // реальну ціль і повертав доменний статус, а не 404 «нема даних».
            const payeeSlug = await createSystemPayee(admin);
            const accountRes = await request(
                'post',
                `/api/admin/payees/${payeeSlug}/accounts`
            )
                .set('Authorization', bearerFor(admin))
                .send({ iban: SYSTEM_IBAN, paymentPurposeTemplate: null })
                .expect(201);
            const accountSlug = (accountRes.body as { data: { slug: string } })
                .data.slug;

            // Звичайний бізнес у стані `pending` — ціль для publicity-роутів.
            const pendingBusiness = await seedPendingBusiness();

            const routes: ReadonlyArray<{
                method: 'get' | 'post' | 'patch' | 'delete';
                path: string;
                body?: Record<string, unknown>;
                expected: number;
            }> = [
                { method: 'get', path: '/api/admin/payees', expected: 200 },
                {
                    method: 'get',
                    path: `/api/admin/payees/${payeeSlug}`,
                    expected: 200,
                },
                {
                    method: 'patch',
                    path: `/api/admin/payees/${payeeSlug}`,
                    body: { name: 'ГУ ДПС у Київській області (оновлено)' },
                    expected: 200,
                },
                {
                    method: 'patch',
                    path: `/api/admin/payees/${payeeSlug}/catalog-visibility`,
                    body: { visible: true },
                    expected: 200,
                },
                {
                    method: 'patch',
                    path: `/api/admin/payees/${payeeSlug}/accounts/${accountSlug}`,
                    body: { name: 'ЄСВ' },
                    expected: 200,
                },
                {
                    method: 'patch',
                    path: `/api/admin/payees/${payeeSlug}/accounts/${accountSlug}/catalog-visibility`,
                    body: { visible: true },
                    expected: 200,
                },
                {
                    method: 'delete',
                    path: `/api/admin/payees/${payeeSlug}/accounts/${accountSlug}`,
                    expected: 200,
                },
                {
                    method: 'delete',
                    path: `/api/admin/payees/${payeeSlug}`,
                    expected: 200,
                },
                { method: 'get', path: '/api/admin/publicity', expected: 200 },
                {
                    method: 'post',
                    path: `/api/admin/publicity/${pendingBusiness.slug}/approve`,
                    body: {},
                    expected: 200,
                },
            ];

            for (const route of routes) {
                const res = await request(route.method, route.path)
                    .set('Authorization', bearerFor(admin))
                    .send(route.body ?? {});
                expect({
                    path: route.path,
                    status: res.status,
                }).toEqual({ path: route.path, status: route.expected });
            }

            // Reject — на окремому бізнесі: `approve` вище вже вивів
            // `pendingBusiness` зі стану `pending`.
            const second = await seedPendingBusiness('petrenko');
            const rejected = await request(
                'post',
                `/api/admin/publicity/${second.slug}/reject`
            )
                .set('Authorization', bearerFor(admin))
                .send({
                    reason: 'Не вдалося підтвердити реальність отримувача',
                });
            expect(rejected.status).toBe(200);
        }, 30_000);
    });

    // ─────────────────────────────────────────────────────────────────────
    // Інваріанти спринта, що живуть на HTTP-контракті адмінки.
    // ─────────────────────────────────────────────────────────────────────

    describe('системний отримувач', () => {
        it('створюється нічий: ownerId null, managers порожні, isSystem true', async () => {
            const admin = await createUser('admin');
            const slug = await createSystemPayee(admin);

            const doc = await businessModel
                .findOne({ slugLower: slug.toLowerCase() })
                .exec();
            expect(doc).not.toBeNull();
            expect(doc!.ownerId).toBeNull();
            expect(doc!.managers).toEqual([]);
            expect(doc!.isSystem).toBe(true);
            // Автор-адмін не стає власником: створення системного запису не
            // прив'язує його до кабінету адміна.
            expect(doc!.ownerId).not.toEqual(admin._id);
        });

        it('дефолт видимості прихований, поки адмін не увімкне явно', async () => {
            const admin = await createUser('admin');
            const slug = await createSystemPayee(admin);

            const created = await businessModel
                .findOne({ slugLower: slug.toLowerCase() })
                .exec();
            expect(created!.catalogVisible).toBe(false);

            const accountRes = await request(
                'post',
                `/api/admin/payees/${slug}/accounts`
            )
                .set('Authorization', bearerFor(admin))
                .send({ iban: SYSTEM_IBAN })
                .expect(201);
            const accountSlug = (accountRes.body as { data: { slug: string } })
                .data.slug;
            const account = await accountModel
                .findOne({ slugLower: accountSlug.toLowerCase() })
                .exec();
            expect(account!.catalogVisible).toBe(false);

            await request(
                'patch',
                `/api/admin/payees/${slug}/accounts/${accountSlug}/catalog-visibility`
            )
                .set('Authorization', bearerFor(admin))
                .send({ visible: true })
                .expect(200);

            const shown = await accountModel
                .findOne({ slugLower: accountSlug.toLowerCase() })
                .exec();
            expect(shown!.catalogVisible).toBe(true);
        });

        it('приховані реквізити системного отримувача зникають і з публічної сторінки', async () => {
            // Картка каталогу веде саме на цю сторінку. Сценарій «держава змінила
            // рахунок: заводимо нові реквізити, старі ховаємо» без фільтра лишав
            // би застарілий IBAN у списку поруч з новим, і платник, що прийшов з
            // каталогу, міг заплатити на мертвий рахунок.
            const admin = await createUser('admin');
            const slug = await createSystemPayee(admin);

            const accountRes = await request(
                'post',
                `/api/admin/payees/${slug}/accounts`
            )
                .set('Authorization', bearerFor(admin))
                .send({ iban: SYSTEM_IBAN })
                .expect(201);
            const accountSlug = (accountRes.body as { data: { slug: string } })
                .data.slug;

            const readAccounts = async (): Promise<string[]> => {
                const res = await request(
                    'get',
                    `/api/businesses/public/${slug}`
                ).expect(200);
                return (
                    res.body as {
                        data: { accounts: Array<{ slug: string }> };
                    }
                ).data.accounts.map((a) => a.slug);
            };

            // Дефолт прихований — рахунка у списку немає.
            expect(await readAccounts()).not.toContain(accountSlug);

            await request(
                'patch',
                `/api/admin/payees/${slug}/accounts/${accountSlug}/catalog-visibility`
            )
                .set('Authorization', bearerFor(admin))
                .send({ visible: true })
                .expect(200);
            expect(await readAccounts()).toContain(accountSlug);

            await request(
                'patch',
                `/api/admin/payees/${slug}/accounts/${accountSlug}/catalog-visibility`
            )
                .set('Authorization', bearerFor(admin))
                .send({ visible: false })
                .expect(200);
            expect(await readAccounts()).not.toContain(accountSlug);
        });

        it('у звичайного отримувача список реквізитів повний попри прапорець каталогу', async () => {
            // Дзеркальна гарантія: прапорець керує лише каталогом, тож фільтр не
            // сміє спорожнити публічні сторінки наявним користувачам.
            const owner = await createUser('user');
            const businessRes = await request('post', '/api/businesses/me')
                .set('Authorization', bearerFor(owner))
                .send(USER_BUSINESS_PAYLOAD)
                .expect(201);
            const businessSlug = (
                businessRes.body as { data: { slug: string } }
            ).data.slug;

            const accountRes = await request(
                'post',
                `/api/businesses/me/${businessSlug}/accounts`
            )
                .set('Authorization', bearerFor(owner))
                .send({ iban: SYSTEM_IBAN })
                .expect(201);
            const accountSlug = (accountRes.body as { data: { slug: string } })
                .data.slug;

            const res = await request(
                'get',
                `/api/businesses/public/${businessSlug}`
            ).expect(200);
            expect(
                (
                    res.body as {
                        data: { accounts: Array<{ slug: string }> };
                    }
                ).data.accounts.map((a) => a.slug)
            ).toContain(accountSlug);
        });

        it('персоналізація понад бюджет payload → 400, а не бита картинка', async () => {
            // Ліміт ПОЛЯ призначення (420 симв. / 840 B) більший за весь бюджет
            // payload (507 B), тож пер-полевий гейт пропускав набір, який далі
            // валив білдер: `qr/personalized.png` віддавав 400 замість картинки,
            // і платник бачив зламане зображення без пояснення.
            const admin = await createUser('admin');
            const longName = 'ГУ ДПС у Дніпропетровській області, '.repeat(3);
            const slug = await createSystemPayee(admin, {
                name: longName.slice(0, 130),
                paymentPurposeTemplate:
                    'Єдиний внесок {taxId} за {period} від {fullName}',
            });
            const accountRes = await request(
                'post',
                `/api/admin/payees/${slug}/accounts`
            )
                .set('Authorization', bearerFor(admin))
                .send({ iban: SYSTEM_IBAN })
                .expect(201);
            const accountSlug = (accountRes.body as { data: { slug: string } })
                .data.slug;

            const qs = new URLSearchParams({
                taxId: '1234567899',
                period: '2026-07',
                // 80 кирилічних символів = 160 B: у межах поля, але payload разом
                // з довгою назвою отримувача перевалює 507 B.
                fullName: 'Полікарпенко-Вишневецький Веніамін'.padEnd(80, 'о'),
            }).toString();

            const res = await request(
                'get',
                `/api/businesses/public/${slug}/account/${accountSlug}/personalized-links?${qs}`
            ).expect(400);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'PERSONALIZATION_TOO_LONG'
            );
        });

        it('адмін-lookup не дістає бізнес користувача: 404 SYSTEM_PAYEE_NOT_FOUND', async () => {
            const admin = await createUser('admin');
            const owner = await createUser('user');
            const userBusinessRes = await request('post', '/api/businesses/me')
                .set('Authorization', bearerFor(owner))
                .send(USER_BUSINESS_PAYLOAD)
                .expect(201);
            const userSlug = (
                userBusinessRes.body as { data: { slug: string } }
            ).data.slug;

            const res = await request('get', `/api/admin/payees/${userSlug}`)
                .set('Authorization', bearerFor(admin))
                .expect(404);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'SYSTEM_PAYEE_NOT_FOUND'
            );
        });
    });

    describe('черга публічності', () => {
        it('схвалення скидає видимість усіх рівнів (дефолт після схвалення все приховане)', async () => {
            const admin = await createUser('admin');
            const business = await seedPendingBusiness('ivanenko', {
                catalogVisible: true,
            });
            const visibleAccounts = await seedAccounts(business._id, 2, true);

            const res = await request(
                'post',
                `/api/admin/publicity/${business.slug}/approve`
            )
                .set('Authorization', bearerFor(admin))
                .send({ category: 'charity' })
                .expect(200);

            const data = (
                res.body as {
                    data: {
                        publicityStatus: string;
                        catalogVisible: boolean;
                        catalogCategory: string;
                    };
                }
            ).data;
            expect(data.publicityStatus).toBe('approved');
            expect(data.catalogVisible).toBe(false);
            expect(data.catalogCategory).toBe('charity');

            const accounts = await accountModel
                .find({ _id: { $in: visibleAccounts } })
                .exec();
            expect(accounts).toHaveLength(2);
            expect(accounts.every((a) => a.catalogVisible === false)).toBe(
                true
            );
        });

        it('черга віддає лише pending-записи, найстаріші зверху', async () => {
            const admin = await createUser('admin');
            const older = await seedPendingBusiness('older', {
                publicityRequestedAt: new Date('2026-07-01T10:00:00Z'),
            });
            const newer = await seedPendingBusiness('newer', {
                publicityRequestedAt: new Date('2026-07-10T10:00:00Z'),
            });
            await seedPendingBusiness('approved-one', {
                publicityStatus: 'approved',
            });

            const res = await request('get', '/api/admin/publicity')
                .set('Authorization', bearerFor(admin))
                .expect(200);
            const slugs = (
                res.body as { data: Array<{ slug: string }> }
            ).data.map((b) => b.slug);
            expect(slugs).toEqual([older.slug, newer.slug]);
        });

        it('відхилення записує причину і переводить у rejected', async () => {
            const admin = await createUser('admin');
            const business = await seedPendingBusiness();

            const res = await request(
                'post',
                `/api/admin/publicity/${business.slug}/reject`
            )
                .set('Authorization', bearerFor(admin))
                .send({ reason: 'Не підтверджено реальність отримувача' })
                .expect(200);

            const data = (
                res.body as {
                    data: {
                        publicityStatus: string;
                        publicityRejectionReason: string;
                    };
                }
            ).data;
            expect(data.publicityStatus).toBe('rejected');
            expect(data.publicityRejectionReason).toBe(
                'Не підтверджено реальність отримувача'
            );
        });

        it('схвалений запис можна забрати з каталогу тим самим reject', async () => {
            // Каталог це вітрина довіри: недоброчесний запис, що вже пройшов
            // схвалення, мусить зніматися важелем адмінки, а не правкою в БД.
            const admin = await createUser('admin');
            const business = await seedPendingBusiness('approved-payee', {
                publicityStatus: 'approved',
                catalogVisible: true,
            });

            const res = await request(
                'post',
                `/api/admin/publicity/${business.slug}/reject`
            )
                .set('Authorization', bearerFor(admin))
                .send({ reason: 'Скарги на отримувача' })
                .expect(200);

            expect(
                (res.body as { data: { publicityStatus: string } }).data
                    .publicityStatus
            ).toBe('rejected');

            // Запис зник з каталогу: `canEnterCatalog` пускає лише `approved`.
            const catalog = await request(
                'get',
                '/api/businesses/public/catalog'
            ).expect(200);
            const payeeSlugs = (
                catalog.body as {
                    data: {
                        sections: Array<{
                            payees: Array<{ slug: string }>;
                        }>;
                    };
                }
            ).data.sections.flatMap((s) => s.payees.map((p) => p.slug));
            expect(payeeSlugs).not.toContain(business.slug);
        });

        it('схвалені віддаються окремим списком для адмінки', async () => {
            const admin = await createUser('admin');
            const approved = await seedPendingBusiness('approved-listed', {
                publicityStatus: 'approved',
            });
            await seedPendingBusiness('still-pending');

            const res = await request('get', '/api/admin/publicity/approved')
                .set('Authorization', bearerFor(admin))
                .expect(200);
            const slugs = (
                res.body as { data: Array<{ slug: string }> }
            ).data.map((b) => b.slug);
            expect(slugs).toEqual([approved.slug]);
        });

        it('порожня причина відхилення → 400 (причину бачить користувач)', async () => {
            const admin = await createUser('admin');
            const business = await seedPendingBusiness();

            await request(
                'post',
                `/api/admin/publicity/${business.slug}/reject`
            )
                .set('Authorization', bearerFor(admin))
                .send({ reason: '   ' })
                .expect(400);
        });

        it('повторне схвалення не-pending запису → 409 PUBLICITY_INVALID_STATE', async () => {
            const admin = await createUser('admin');
            const business = await seedPendingBusiness();

            await request(
                'post',
                `/api/admin/publicity/${business.slug}/approve`
            )
                .set('Authorization', bearerFor(admin))
                .send({})
                .expect(200);

            const res = await request(
                'post',
                `/api/admin/publicity/${business.slug}/approve`
            )
                .set('Authorization', bearerFor(admin))
                .send({})
                .expect(409);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'PUBLICITY_INVALID_STATE'
            );
        });

        it('черга не чіпає системних отримувачів (вони не проходять схвалення)', async () => {
            const admin = await createUser('admin');
            const slug = await createSystemPayee(admin);

            const res = await request(
                'post',
                `/api/admin/publicity/${slug}/approve`
            )
                .set('Authorization', bearerFor(admin))
                .send({});
            expect(res.status).toBe(409);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'PUBLICITY_INVALID_STATE'
            );
        });
    });

    describe('маркери підстановки у призначенні', () => {
        it('адмін зберігає відомі маркери на системному отримувачі', async () => {
            const admin = await createUser('admin');
            const slug = await createSystemPayee(admin);

            const doc = await businessModel
                .findOne({ slugLower: slug.toLowerCase() })
                .exec();
            expect(doc!.paymentPurposeTemplate).toBe(MARKER_TEMPLATE);
        });

        it('адмін зберігає маркери у призначенні реквізитів системного отримувача', async () => {
            const admin = await createUser('admin');
            const slug = await createSystemPayee(admin);

            const res = await request(
                'post',
                `/api/admin/payees/${slug}/accounts`
            )
                .set('Authorization', bearerFor(admin))
                .send({
                    iban: SYSTEM_IBAN_SECOND,
                    paymentPurposeTemplate: 'Військовий збір {taxId} {period}',
                })
                .expect(201);
            expect(
                (res.body as { data: { paymentPurposeTemplate: string } }).data
                    .paymentPurposeTemplate
            ).toBe('Військовий збір {taxId} {period}');
        });

        it('невідомий маркер відхиляється навіть у адміна → PURPOSE_MARKER_UNKNOWN', async () => {
            const admin = await createUser('admin');
            const res = await request('post', '/api/admin/payees')
                .set('Authorization', bearerFor(admin))
                .send({
                    ...SYSTEM_PAYEE_PAYLOAD,
                    paymentPurposeTemplate: 'Єдиний внесок {oblast}',
                })
                .expect(400);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'PURPOSE_MARKER_UNKNOWN'
            );
        });

        it('маркер у шаблоні звичайного отримувача → 400 PURPOSE_MARKERS_NOT_ALLOWED', async () => {
            const owner = await createUser('user');
            const res = await request('post', '/api/businesses/me')
                .set('Authorization', bearerFor(owner))
                .send({
                    ...USER_BUSINESS_PAYLOAD,
                    paymentPurposeTemplate: MARKER_TEMPLATE,
                })
                .expect(400);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'PURPOSE_MARKERS_NOT_ALLOWED'
            );
        });

        it('маркер у призначенні реквізитів звичайного отримувача → 400 PURPOSE_MARKERS_NOT_ALLOWED', async () => {
            const owner = await createUser('user');
            const created = await request('post', '/api/businesses/me')
                .set('Authorization', bearerFor(owner))
                .send(USER_BUSINESS_PAYLOAD)
                .expect(201);
            const slug = (created.body as { data: { slug: string } }).data.slug;

            const res = await request(
                'post',
                `/api/businesses/me/${slug}/accounts`
            )
                .set('Authorization', bearerFor(owner))
                .send({
                    iban: USER_IBAN,
                    paymentPurposeTemplate: MARKER_TEMPLATE,
                })
                .expect(400);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'PURPOSE_MARKERS_NOT_ALLOWED'
            );
        });
    });

    // ─── seed-хелпери ────────────────────────────────────────────────────

    async function seedPendingBusiness(
        slug = 'ivanenko',
        overrides: Record<string, unknown> = {}
    ): Promise<BusinessDocument> {
        const owner = await createUser('user');
        return businessModel.create({
            type: 'fop',
            name: 'ФОП Іваненко',
            taxId: '1234567899',
            taxationSystem: 'simplified-3',
            isVatPayer: false,
            paymentPurposeTemplate: 'Оплата за послуги',
            slug,
            slugLower: slug.toLowerCase(),
            slugCustomized: true,
            ownerId: owner._id,
            managers: [],
            publicityStatus: 'pending',
            publicityRequestedAt: new Date(),
            ...overrides,
        });
    }

    async function seedAccounts(
        businessId: Types.ObjectId,
        count: number,
        catalogVisible: boolean
    ): Promise<Types.ObjectId[]> {
        const ids: Types.ObjectId[] = [];
        for (let i = 0; i < count; i += 1) {
            const slug = `rahunok-${i}`;
            const doc = await accountModel.create({
                businessId,
                iban: `UA9030529929900041491234567${i}${i}`,
                bankCode: null,
                name: null,
                slug,
                slugLower: slug,
                slugCustomized: true,
                catalogVisible,
            });
            ids.push(doc._id);
        }
        return ids;
    }
});
