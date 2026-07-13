import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as cookieParser from 'cookie-parser';
import * as supertest from 'supertest';
import { App } from 'supertest/types';
import { ZodValidationPipe } from 'nestjs-zod';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';

import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { REDIS_CLIENT, RedisModule } from '../src/common/modules/redis.module';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { AuthModule } from '../src/modules/auth/auth.module';
import { EmailModule } from '../src/modules/email/email.module';
import { UsersModule } from '../src/modules/users/users.module';
import { ReportsModule } from '../src/modules/reports/reports.module';
import { StorageModule } from '../src/modules/storage/storage.module';
import { PaymentsModule } from '../src/modules/payments/payments.module';
import { LandingClaimModule } from '../src/modules/landing-claim/landing-claim.module';
import { User, UserDocument } from '../src/modules/users/schemas/user.schema';
import { EmailService } from '../src/modules/email/email.service';
import { CURRENT_TERMS_VERSION } from '@finly/types';

// Mock ENV
jest.mock('../src/config/env', () => ({
    ENV: {
        NODE_ENV: 'test',
        PORT: '4000',
        WEB_URL: 'http://localhost:3000',
        MONGODB_URI: 'overridden-by-MongoMemoryServer',
        REDIS_URL: 'redis://mock',
        JWT_ACCESS_SECRET: 'e2e-test-access-secret-must-be-long-enough',
        JWT_REFRESH_SECRET: 'e2e-test-refresh-secret-must-be-long-enough',
        GOOGLE_CLIENT_ID: 'test-id.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'GOCSPX-test-secret',
        GOOGLE_CALLBACK_URL: 'http://localhost:4000/api/auth/google/callback',
        RESEND_API_KEY: 're_test_key',
        RESEND_FROM_EMAIL: 'Finly <test@test.com>',
        STRIPE_SECRET_KEY: 'sk_test_xxx',
        STRIPE_WEBHOOK_SECRET: 'whsec_test',
        AUTH_LOCKOUT_THRESHOLDS: '5:1,10:5,20:15',
        AUTH_LOGIN_ATTEMPTS_TTL_MIN: 15,
        AUTH_MAGIC_LINK_TTL_MIN: 15,
        AUTH_MAGIC_LINK_RATE_LIMIT: 3,
        AUTH_MAGIC_LINK_RATE_WINDOW_MIN: 15,
        AUTH_MAGIC_LINK_DEDUP_SEC: 60,
        ACCOUNT_DELETION_GRACE_DAYS: 30,
        AUTH_PASSWORD_MIN_LENGTH: 8,
    },
    parseLockoutThresholds: (raw: string) =>
        raw.split(',').map((entry: string) => {
            const [attempts, blockMin] = entry.split(':').map(Number);
            return { attempts, blockMin };
        }),
}));

// ─── Stateful in-memory Redis mock ───

function createStatefulRedisMock() {
    const store = new Map<string, string>();

    function createPipeline() {
        const ops: Array<() => void> = [];
        const pipe = {
            set(key: string, value: string, _ex?: string, _ttl?: number) {
                ops.push(() => store.set(key, value));
                return pipe;
            },
            del(key: string) {
                ops.push(() => store.delete(key));
                return pipe;
            },
            incr(key: string) {
                ops.push(() => {
                    const val = store.get(key);
                    store.set(key, String((parseInt(val ?? '0', 10) || 0) + 1));
                });
                return pipe;
            },
            expire(_key: string, _ttl: number) {
                // TTL ignored in tests
                return pipe;
            },
            sadd(key: string, ...members: string[]) {
                ops.push(() => {
                    const existing = store.get(key);
                    const set: Set<string> = existing
                        ? new Set(JSON.parse(existing) as string[])
                        : new Set<string>();
                    for (const m of members) set.add(m);
                    store.set(key, JSON.stringify([...set]));
                });
                return pipe;
            },
            srem(key: string, ...members: string[]) {
                ops.push(() => {
                    const existing = store.get(key);
                    if (!existing) return;
                    const set: Set<string> = new Set(
                        JSON.parse(existing) as string[]
                    );
                    for (const m of members) set.delete(m);
                    if (set.size === 0) store.delete(key);
                    else store.set(key, JSON.stringify([...set]));
                });
                return pipe;
            },
            async exec() {
                for (const op of ops) op();
                return [];
            },
        };
        return pipe;
    }

    const redis = {
        ping: jest.fn().mockResolvedValue('PONG'),
        quit: jest.fn().mockResolvedValue('OK'),
        on: jest.fn().mockReturnThis(),

        /**
         * Lua-скрипти: `RedisCounterService` (INCR+EXPIRE лічильники lockout /
         * rate-limit) і `RedisLockService` (compare-and-delete release). TTL у
         * тестах ігнорується, як і в решті мока.
         */
        async eval(
            script: string,
            _numKeys: number,
            key: string,
            arg?: string | number
        ) {
            if (script.includes("'INCR'")) {
                const next = (parseInt(store.get(key) ?? '0', 10) || 0) + 1;
                store.set(key, String(next));
                return next;
            }
            if (script.includes("'GET'") && script.includes("'DEL'")) {
                if (store.get(key) === String(arg)) {
                    store.delete(key);
                    return 1;
                }
                return 0;
            }
            return 0;
        },

        async get(key: string) {
            return store.get(key) ?? null;
        },
        async getdel(key: string) {
            const val = store.get(key) ?? null;
            if (val !== null) store.delete(key);
            return val;
        },
        async set(key: string, value: string, _ex?: string, _ttl?: number) {
            store.set(key, value);
            return 'OK';
        },
        async del(key: string) {
            store.delete(key);
            return 1;
        },
        async incr(key: string) {
            const current = parseInt(store.get(key) ?? '0', 10) || 0;
            const next = current + 1;
            store.set(key, String(next));
            return next;
        },
        async expire(_key: string, _ttl: number) {
            return 1;
        },
        async smembers(key: string) {
            const val = store.get(key);
            if (!val) return [];
            return JSON.parse(val) as string[];
        },
        async srem(key: string, ...members: string[]) {
            const val = store.get(key);
            if (!val) return 0;
            const set: Set<string> = new Set(JSON.parse(val) as string[]);
            let removed = 0;
            for (const m of members) {
                if (set.delete(m)) removed++;
            }
            if (set.size === 0) store.delete(key);
            else store.set(key, JSON.stringify([...set]));
            return removed;
        },
        pipeline() {
            return createPipeline();
        },

        // Test utilities
        _store: store,
        _clear() {
            store.clear();
        },
    };

    return redis;
}

// ─── Mock EmailService ───

const emailCalls: Array<{
    method: string;
    args: unknown[];
}> = [];

const mockEmailService = {
    sendMagicLink: jest.fn((...args: unknown[]) => {
        emailCalls.push({ method: 'sendMagicLink', args });
        return Promise.resolve();
    }),
    sendDeletionConfirmation: jest.fn((...args: unknown[]) => {
        emailCalls.push({ method: 'sendDeletionConfirmation', args });
        return Promise.resolve();
    }),
};

// ─── Test setup ───

describe('Auth E2E', () => {
    let app: INestApplication<App>;
    let mongoServer: MongoMemoryServer;
    let userModel: Model<UserDocument>;
    let redisMock: ReturnType<typeof createStatefulRedisMock>;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        redisMock = createStatefulRedisMock();

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true }),
                ThrottlerModule.forRoot({
                    throttlers: [{ ttl: 60000, limit: 600 }],
                }),
                MongooseModule.forRoot(mongoServer.getUri()),
                // @Global RedisModule мусить бути у графі тест-композиції,
                // інакше токен REDIS_CLIENT не існує і override не діє.
                RedisModule,
                AuthModule,
                EmailModule,
                UsersModule,
                ReportsModule,
                StorageModule,
                PaymentsModule,
                // Sprint 13 переніс POST /auth/magic-link/verify у
                // MagicLinkVerifyController (LandingClaimModule) — без нього
                // verify-тести били б у неіснуючий маршрут (404).
                LandingClaimModule,
            ],
            controllers: [AppController],
            providers: [
                AppService,
                { provide: APP_GUARD, useClass: ThrottlerGuard },
            ],
        })
            .overrideProvider(REDIS_CLIENT)
            .useValue(redisMock)
            .overrideProvider(EmailService)
            .useValue(mockEmailService)
            .compile();

        app = moduleFixture.createNestApplication();
        app.use(cookieParser());
        app.setGlobalPrefix('api');
        app.useGlobalPipes(new ZodValidationPipe());
        app.useGlobalFilters(new AllExceptionsFilter());
        await app.init();

        userModel = moduleFixture.get<Model<UserDocument>>(
            getModelToken(User.name)
        );
    }, 60_000);

    afterAll(async () => {
        await app.close();
        await mongoServer.stop();
    });

    beforeEach(async () => {
        redisMock._clear();
        emailCalls.length = 0;
        mockEmailService.sendMagicLink.mockClear();
        mockEmailService.sendDeletionConfirmation.mockClear();
        await userModel.deleteMany({});
    });

    // ─── Helper functions ───

    async function createUserWithPassword(
        email: string,
        password: string
    ): Promise<UserDocument> {
        const hash = await bcrypt.hash(password, 10);
        return userModel.create({
            email: email.toLowerCase(),
            passwordHash: hash,
            profile: { firstName: 'Test', lastName: 'User' },
        });
    }

    async function createUserWithoutPassword(
        email: string
    ): Promise<UserDocument> {
        return userModel.create({
            email: email.toLowerCase(),
            profile: { firstName: 'Test', lastName: 'User' },
        });
    }

    async function softDeleteUser(email: string): Promise<void> {
        await userModel.updateOne(
            { email: email.toLowerCase() },
            { deletedAt: new Date() }
        );
    }

    function createMagicLinkToken(email: string, purpose = 'login'): string {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- inline utility in test helper
        const token = require('crypto').randomBytes(32).toString('hex');
        const payload = JSON.stringify({
            email: email.toLowerCase(),
            purpose,
        });
        redisMock._store.set(`magic:${token}`, payload);
        return token;
    }

    async function loginWithPassword(
        email: string,
        password: string
    ): Promise<{ accessToken: string; cookies: string[] }> {
        const res = await supertest(app.getHttpServer())
            .post('/api/auth/login/password')
            .send({ email, password })
            .expect(201);

        const body = res.body as { data: { accessToken: string } };
        return {
            accessToken: body.data.accessToken,
            cookies: res.headers['set-cookie'] as unknown as string[],
        };
    }

    async function loginViaMagicLink(
        email: string,
        purpose = 'login'
    ): Promise<{ accessToken: string; cookies: string[] }> {
        const token = createMagicLinkToken(email, purpose);
        const res = await supertest(app.getHttpServer())
            .post('/api/auth/magic-link/verify')
            .send({ token })
            .expect(201);

        const body = res.body as { data: { accessToken: string } };
        return {
            accessToken: body.data.accessToken,
            cookies: res.headers['set-cookie'] as unknown as string[],
        };
    }

    function extractRefreshCookie(cookies: string[]): string {
        const refreshCookie = cookies?.find((c: string) =>
            c.startsWith('bid_refresh=')
        );
        if (!refreshCookie) throw new Error('No bid_refresh cookie found');
        return refreshCookie.split(';')[0].replace('bid_refresh=', '');
    }

    // ─── A. Check Email flow ───

    describe('Check Email flow', () => {
        it('should return isNewUser: true for unknown email', async () => {
            const res = await supertest(app.getHttpServer())
                .post('/api/auth/check-email')
                .send({ email: 'new@example.com' })
                .expect(201);

            expect(res.body).toEqual({
                data: { hasPassword: false, isNewUser: true },
            });
        });

        it('should return hasPassword: true for user with password', async () => {
            await createUserWithPassword('user@example.com', 'password123');

            const res = await supertest(app.getHttpServer())
                .post('/api/auth/check-email')
                .send({ email: 'user@example.com' })
                .expect(201);

            expect(res.body).toEqual({
                data: { hasPassword: true, isNewUser: false },
            });
        });

        it('should return hasPassword: false for user without password', async () => {
            await createUserWithoutPassword('oauth@example.com');

            const res = await supertest(app.getHttpServer())
                .post('/api/auth/check-email')
                .send({ email: 'oauth@example.com' })
                .expect(201);

            expect(res.body).toEqual({
                data: { hasPassword: false, isNewUser: false },
            });
        });

        it('should return 400 for invalid email', async () => {
            await supertest(app.getHttpServer())
                .post('/api/auth/check-email')
                .send({ email: 'not-an-email' })
                .expect(400);
        });

        it('should rate limit after 10 requests from same IP', async () => {
            // First 10 should pass — but rate limit key increments each time
            // After checkEmailRateLimit sees count >= 10, it throws 429
            // We need to pre-seed the counter
            redisMock._store.set('check_email:::ffff:127.0.0.1', '10');

            await supertest(app.getHttpServer())
                .post('/api/auth/check-email')
                .send({ email: 'test@example.com' })
                .expect(429);
        });
    });

    // ─── B. Password Login flow ───

    describe('Password Login flow', () => {
        it('should return tokens and user on valid credentials', async () => {
            await createUserWithPassword('user@example.com', 'password123');

            const res = await supertest(app.getHttpServer())
                .post('/api/auth/login/password')
                .send({ email: 'user@example.com', password: 'password123' })
                .expect(201);

            const body = res.body as {
                data: {
                    user: { email: string };
                    accessToken: string;
                };
            };
            expect(body.data.user.email).toBe('user@example.com');
            expect(body.data.accessToken).toBeDefined();
            expect(res.headers['set-cookie']).toBeDefined();
        });

        it('should set httpOnly bid_refresh cookie', async () => {
            await createUserWithPassword('user@example.com', 'password123');

            const res = await supertest(app.getHttpServer())
                .post('/api/auth/login/password')
                .send({ email: 'user@example.com', password: 'password123' })
                .expect(201);

            const cookies = res.headers['set-cookie'] as unknown as string[];
            const refreshCookie = cookies.find((c: string) =>
                c.startsWith('bid_refresh=')
            );
            expect(refreshCookie).toBeDefined();
            expect(refreshCookie).toContain('HttpOnly');
            expect(refreshCookie).toContain('Path=/');
        });

        it('should return 401 on wrong password', async () => {
            await createUserWithPassword('user@example.com', 'correct');

            const res = await supertest(app.getHttpServer())
                .post('/api/auth/login/password')
                .send({ email: 'user@example.com', password: 'wrong' })
                .expect(401);

            expect(res.body).toHaveProperty('error');
        });

        it('should return 401 for nonexistent email', async () => {
            await supertest(app.getHttpServer())
                .post('/api/auth/login/password')
                .send({
                    email: 'nonexistent@example.com',
                    password: 'password',
                })
                .expect(401);
        });

        it('should return 401 for user without password', async () => {
            await createUserWithoutPassword('oauth@example.com');

            await supertest(app.getHttpServer())
                .post('/api/auth/login/password')
                .send({ email: 'oauth@example.com', password: 'anypass1' })
                .expect(401);
        });

        it('should return 429 after progressive lockout threshold', async () => {
            // Pre-seed 5 failed attempts
            redisMock._store.set(
                'login_attempts:::ffff:127.0.0.1:user@example.com',
                '5'
            );

            await supertest(app.getHttpServer())
                .post('/api/auth/login/password')
                .send({
                    email: 'user@example.com',
                    password: 'anypass1',
                })
                .expect(429);
        });

        it('should clear login attempts on successful login', async () => {
            await createUserWithPassword('user@example.com', 'password123');
            redisMock._store.set(
                'login_attempts:::ffff:127.0.0.1:user@example.com',
                '3'
            );

            await supertest(app.getHttpServer())
                .post('/api/auth/login/password')
                .send({ email: 'user@example.com', password: 'password123' })
                .expect(201);

            expect(
                redisMock._store.has(
                    'login_attempts:::ffff:127.0.0.1:user@example.com'
                )
            ).toBe(false);
        });

        it('should return accountDeleted: true for deleted user', async () => {
            await createUserWithPassword('user@example.com', 'password123');
            await softDeleteUser('user@example.com');

            const res = await supertest(app.getHttpServer())
                .post('/api/auth/login/password')
                .send({ email: 'user@example.com', password: 'password123' })
                .expect(201);

            const body = res.body as {
                data: { accountDeleted?: boolean };
            };
            expect(body.data.accountDeleted).toBe(true);
        });
    });

    // ─── C. Magic Link flow ───

    describe('Magic Link flow', () => {
        it('should send magic link successfully', async () => {
            await supertest(app.getHttpServer())
                .post('/api/auth/magic-link/send')
                .send({ email: 'user@example.com' })
                .expect(201);

            expect(mockEmailService.sendMagicLink).toHaveBeenCalled();
        });

        it('should send with each purpose', async () => {
            // `delete-account` свідомо НЕ приймається публічним send-ендпоінтом
            // (контролер відповідає 400): видалення акаунта шле власний
            // magic-link через POST /users/account/delete.
            const purposes = ['login', 'register', 'reset-password'];
            for (const purpose of purposes) {
                redisMock._clear();
                mockEmailService.sendMagicLink.mockClear();

                await supertest(app.getHttpServer())
                    .post('/api/auth/magic-link/send')
                    .send({ email: `test-${purpose}@example.com`, purpose })
                    .expect(201);

                expect(mockEmailService.sendMagicLink).toHaveBeenCalled();
            }

            mockEmailService.sendMagicLink.mockClear();
            await supertest(app.getHttpServer())
                .post('/api/auth/magic-link/send')
                .send({
                    email: 'test-delete@example.com',
                    purpose: 'delete-account',
                })
                .expect(400);
            expect(mockEmailService.sendMagicLink).not.toHaveBeenCalled();
        });

        it('should rate limit after 3 requests for same email', async () => {
            redisMock._store.set('ratelimit:magic:rate@example.com', '3');

            await supertest(app.getHttpServer())
                .post('/api/auth/magic-link/send')
                .send({ email: 'rate@example.com' })
                .expect(429);
        });

        it('should skip sending on dedup but return success', async () => {
            redisMock._store.set(
                'magic_dedup:user@example.com:login',
                'existing-token'
            );
            // Sprint 10 overwrite-flow: dedup спрацьовує лише коли живий і сам
            // magic-record (інакше fall-through на повторний send як
            // defense-in-depth). Сидимо обидва ключі, як у реальному Redis.
            redisMock._store.set(
                'magic:existing-token',
                JSON.stringify({
                    email: 'user@example.com',
                    purpose: 'login',
                })
            );

            await supertest(app.getHttpServer())
                .post('/api/auth/magic-link/send')
                .send({ email: 'user@example.com', purpose: 'login' })
                .expect(201);

            expect(mockEmailService.sendMagicLink).not.toHaveBeenCalled();
        });

        it('should verify magic link and return user + tokens', async () => {
            await createUserWithoutPassword('user@example.com');
            const token = createMagicLinkToken('user@example.com', 'login');

            const res = await supertest(app.getHttpServer())
                .post('/api/auth/magic-link/verify')
                .send({ token })
                .expect(201);

            const body = res.body as {
                data: {
                    accessToken: string;
                    purpose: string;
                    user: { email: string };
                };
            };
            expect(body.data.accessToken).toBeDefined();
            expect(body.data.purpose).toBe('login');
            expect(body.data.user.email).toBe('user@example.com');

            // Cookie should be set
            const cookies = res.headers['set-cookie'] as unknown as string[];
            expect(
                cookies?.some((c: string) => c.startsWith('bid_refresh='))
            ).toBe(true);
        });

        it('should create new user on verify with register purpose', async () => {
            const token = createMagicLinkToken(
                'newuser@example.com',
                'register'
            );

            const res = await supertest(app.getHttpServer())
                .post('/api/auth/magic-link/verify')
                .send({ token })
                .expect(201);

            const body = res.body as {
                data: { purpose: string; user: { email: string } };
            };
            expect(body.data.purpose).toBe('register');
            expect(body.data.user.email).toBe('newuser@example.com');

            // Verify user created in DB
            const user = await userModel.findOne({
                email: 'newuser@example.com',
            });
            expect(user).toBeTruthy();
        });

        it('should return purpose for reset-password', async () => {
            await createUserWithPassword('user@example.com', 'password123');
            const token = createMagicLinkToken(
                'user@example.com',
                'reset-password'
            );

            const res = await supertest(app.getHttpServer())
                .post('/api/auth/magic-link/verify')
                .send({ token })
                .expect(201);

            const body = res.body as { data: { purpose: string } };
            expect(body.data.purpose).toBe('reset-password');
        });

        it('should soft-delete user for delete-account purpose', async () => {
            await createUserWithPassword('user@example.com', 'password123');
            const token = createMagicLinkToken(
                'user@example.com',
                'delete-account'
            );

            const res = await supertest(app.getHttpServer())
                .post('/api/auth/magic-link/verify')
                .send({ token })
                .expect(201);

            const body = res.body as {
                data: { deleted: boolean; message: string };
            };
            expect(body.data.deleted).toBe(true);

            // Verify user is soft-deleted
            const user = await userModel.findOne({
                email: 'user@example.com',
            });
            expect(user?.deletedAt).toBeTruthy();

            // Deletion confirmation email should be sent
            expect(
                mockEmailService.sendDeletionConfirmation
            ).toHaveBeenCalled();
        });

        it('should return 401 for invalid/expired token', async () => {
            await supertest(app.getHttpServer())
                .post('/api/auth/magic-link/verify')
                .send({ token: 'a'.repeat(64) })
                .expect(401);
        });
    });

    // ─── D. Password Management ───

    describe('Password Management', () => {
        describe('POST /api/auth/password/set', () => {
            it('should set password for user without password', async () => {
                await createUserWithoutPassword('user@example.com');
                const { accessToken } =
                    await loginViaMagicLink('user@example.com');

                await supertest(app.getHttpServer())
                    .post('/api/auth/password/set')
                    .set('Authorization', `Bearer ${accessToken}`)
                    .send({ password: 'newpass123' })
                    .expect(201);

                // Verify password was set
                const user = await userModel.findOne({
                    email: 'user@example.com',
                });
                expect(user?.passwordHash).toBeTruthy();
            });

            it('should return 400 if password already set', async () => {
                await createUserWithPassword('user@example.com', 'existing1');
                const { accessToken } = await loginWithPassword(
                    'user@example.com',
                    'existing1'
                );

                await supertest(app.getHttpServer())
                    .post('/api/auth/password/set')
                    .set('Authorization', `Bearer ${accessToken}`)
                    .send({ password: 'newpass123' })
                    .expect(400);
            });

            it('should return 401 without auth', async () => {
                await supertest(app.getHttpServer())
                    .post('/api/auth/password/set')
                    .send({ password: 'newpass123' })
                    .expect(401);
            });
        });

        describe('POST /api/auth/password/change', () => {
            it('should change password and return new tokens', async () => {
                await createUserWithPassword('user@example.com', 'oldpass12');
                const { accessToken } = await loginWithPassword(
                    'user@example.com',
                    'oldpass12'
                );

                const res = await supertest(app.getHttpServer())
                    .post('/api/auth/password/change')
                    .set('Authorization', `Bearer ${accessToken}`)
                    .send({
                        currentPassword: 'oldpass12',
                        newPassword: 'newpass12',
                    })
                    .expect(201);

                const body = res.body as {
                    data: { accessToken: string };
                };
                expect(body.data.accessToken).toBeDefined();

                // Cookie should be updated
                const cookies = res.headers[
                    'set-cookie'
                ] as unknown as string[];
                expect(
                    cookies?.some((c: string) => c.startsWith('bid_refresh='))
                ).toBe(true);
            });

            it('should return 401 on wrong current password', async () => {
                await createUserWithPassword('user@example.com', 'correct1');
                const { accessToken } = await loginWithPassword(
                    'user@example.com',
                    'correct1'
                );

                await supertest(app.getHttpServer())
                    .post('/api/auth/password/change')
                    .set('Authorization', `Bearer ${accessToken}`)
                    .send({
                        currentPassword: 'wrongone',
                        newPassword: 'newpass12',
                    })
                    .expect(401);
            });

            it('should return 401 without auth', async () => {
                await supertest(app.getHttpServer())
                    .post('/api/auth/password/change')
                    .send({
                        currentPassword: 'old12345',
                        newPassword: 'new12345',
                    })
                    .expect(401);
            });
        });

        describe('POST /api/auth/password/verify', () => {
            it('should return isValid: true for correct password', async () => {
                await createUserWithPassword('user@example.com', 'password123');
                const { accessToken } = await loginWithPassword(
                    'user@example.com',
                    'password123'
                );

                const res = await supertest(app.getHttpServer())
                    .post('/api/auth/password/verify')
                    .set('Authorization', `Bearer ${accessToken}`)
                    .send({ password: 'password123' })
                    .expect(201);

                expect(res.body).toEqual({ data: { isValid: true } });
            });

            it('should return isValid: false for wrong password', async () => {
                await createUserWithPassword('user@example.com', 'password123');
                const { accessToken } = await loginWithPassword(
                    'user@example.com',
                    'password123'
                );

                const res = await supertest(app.getHttpServer())
                    .post('/api/auth/password/verify')
                    .set('Authorization', `Bearer ${accessToken}`)
                    .send({ password: 'wrongpass' })
                    .expect(201);

                expect(res.body).toEqual({ data: { isValid: false } });
            });

            it('should return 401 without auth', async () => {
                await supertest(app.getHttpServer())
                    .post('/api/auth/password/verify')
                    .send({ password: 'anything' })
                    .expect(401);
            });
        });
    });

    // ─── E. User Profile ───

    describe('User Profile', () => {
        it('GET /api/users/me should return full profile', async () => {
            await createUserWithPassword('user@example.com', 'password123');
            const { accessToken } = await loginWithPassword(
                'user@example.com',
                'password123'
            );

            const res = await supertest(app.getHttpServer())
                .get('/api/users/me')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(200);

            const body = res.body as {
                data: {
                    id: string;
                    email: string;
                    profile: object;
                    hasPassword: boolean;
                    deletedAt: null;
                    accountDeletionRequestedAt: null;
                    termsVersion: string | null;
                };
            };
            expect(body.data.email).toBe('user@example.com');
            expect(body.data.hasPassword).toBe(true);
            expect(body.data.id).toBeDefined();
            expect(body.data.profile).toBeDefined();
            // Sprint 27 — профіль більше не несе `executions`/`billing`
            // (білінг переїхав у окремий `GET /api/payments/profile`).
        });

        it('GET /api/users/me should return 401 without auth', async () => {
            await supertest(app.getHttpServer())
                .get('/api/users/me')
                .expect(401);
        });

        it('PATCH /api/users/me should update name', async () => {
            await createUserWithPassword('user@example.com', 'password123');
            const { accessToken } = await loginWithPassword(
                'user@example.com',
                'password123'
            );

            const res = await supertest(app.getHttpServer())
                .patch('/api/users/me')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({ firstName: 'Updated', lastName: 'Name' })
                .expect(200);

            const body = res.body as {
                data: { profile: { firstName: string; lastName: string } };
            };
            expect(body.data.profile.firstName).toBe('Updated');
            expect(body.data.profile.lastName).toBe('Name');
        });

        it('PATCH /api/users/me should return 401 without auth', async () => {
            await supertest(app.getHttpServer())
                .patch('/api/users/me')
                .send({ firstName: 'Test' })
                .expect(401);
        });
    });

    // ─── F. Account Deletion flow ───

    describe('Account Deletion flow', () => {
        it('should return requiresPassword for user with password', async () => {
            await createUserWithPassword('user@example.com', 'password123');
            const { accessToken } = await loginWithPassword(
                'user@example.com',
                'password123'
            );

            const res = await supertest(app.getHttpServer())
                .post('/api/users/account/delete')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(201);

            expect(res.body).toEqual({
                data: { requiresPassword: true },
            });
        });

        it('should return requiresMagicLink for user without password', async () => {
            await createUserWithoutPassword('user@example.com');
            const { accessToken } = await loginViaMagicLink('user@example.com');

            const res = await supertest(app.getHttpServer())
                .post('/api/users/account/delete')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(201);

            const body = res.body as {
                data: { requiresMagicLink: boolean };
            };
            expect(body.data.requiresMagicLink).toBe(true);
            expect(mockEmailService.sendMagicLink).toHaveBeenCalled();
        });

        it('should confirm deletion with valid password', async () => {
            await createUserWithPassword('user@example.com', 'password123');
            const { accessToken } = await loginWithPassword(
                'user@example.com',
                'password123'
            );

            const res = await supertest(app.getHttpServer())
                .post('/api/users/account/delete/confirm')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({ password: 'password123' })
                .expect(201);

            const body = res.body as {
                data: { code: string };
            };
            expect(body.data.code).toBe('ACCOUNT_DELETED');

            // Verify soft-deleted
            const user = await userModel.findOne({
                email: 'user@example.com',
            });
            expect(user?.deletedAt).toBeTruthy();

            // Verify cookie cleared
            const cookies = res.headers['set-cookie'] as unknown as string[];
            const cleared = cookies?.find((c: string) =>
                c.includes('bid_refresh=;')
            );
            expect(cleared).toBeDefined();
        });

        it('should reject deletion with wrong password', async () => {
            await createUserWithPassword('user@example.com', 'password123');
            const { accessToken } = await loginWithPassword(
                'user@example.com',
                'password123'
            );

            await supertest(app.getHttpServer())
                .post('/api/users/account/delete/confirm')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({ password: 'wrongpass' })
                .expect(401);
        });

        it('should return 401 without auth', async () => {
            await supertest(app.getHttpServer())
                .post('/api/users/account/delete')
                .expect(401);
        });
    });

    // ─── G. Account Restore flow ───

    describe('Account Restore flow', () => {
        // Note: JwtStrategy rejects users with deletedAt set (returns null → 401).
        // This means deleted users cannot access /account/restore via JWT.
        it('should allow deleted user to restore via JwtAuthGuard (not JwtActiveGuard)', async () => {
            await createUserWithPassword('user@example.com', 'password123');
            const { accessToken } = await loginWithPassword(
                'user@example.com',
                'password123'
            );
            await softDeleteUser('user@example.com');

            // JwtAuthGuard allows deleted users — restore endpoint is accessible
            await supertest(app.getHttpServer())
                .post('/api/users/account/restore')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(201);
        });

        it('should return 400 when account is not deleted', async () => {
            await createUserWithPassword('user@example.com', 'password123');
            const { accessToken } = await loginWithPassword(
                'user@example.com',
                'password123'
            );

            await supertest(app.getHttpServer())
                .post('/api/users/account/restore')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(400);
        });

        it('should return 401 without auth', async () => {
            await supertest(app.getHttpServer())
                .post('/api/users/account/restore')
                .expect(401);
        });
    });

    // ─── H. Token Lifecycle ───

    describe('Token Lifecycle', () => {
        it('should refresh token and return new accessToken + cookie', async () => {
            await createUserWithPassword('user@example.com', 'password123');
            const { cookies } = await loginWithPassword(
                'user@example.com',
                'password123'
            );
            const refreshCookie = extractRefreshCookie(cookies);

            const res = await supertest(app.getHttpServer())
                .post('/api/auth/refresh')
                .set('Cookie', `bid_refresh=${refreshCookie}`)
                .send({})
                .expect(201);

            const body = res.body as { data: { accessToken: string } };
            expect(body.data.accessToken).toBeDefined();

            const newCookies = res.headers['set-cookie'] as unknown as string[];
            expect(
                newCookies?.some((c: string) => c.startsWith('bid_refresh='))
            ).toBe(true);
        });

        it('should return 401 on refresh without cookie', async () => {
            await supertest(app.getHttpServer())
                .post('/api/auth/refresh')
                .send({})
                .expect(401);
        });

        it('should logout and clear cookie', async () => {
            await createUserWithPassword('user@example.com', 'password123');
            const { cookies } = await loginWithPassword(
                'user@example.com',
                'password123'
            );
            const refreshCookie = extractRefreshCookie(cookies);

            const res = await supertest(app.getHttpServer())
                .post('/api/auth/logout')
                .set('Cookie', `bid_refresh=${refreshCookie}`)
                .expect(201);

            const body = res.body as { data: { code: string } };
            expect(body.data.code).toBe('LOGGED_OUT');

            const resCookies = res.headers['set-cookie'] as unknown as string[];
            const cleared = resCookies?.find((c: string) =>
                c.includes('bid_refresh=;')
            );
            expect(cleared).toBeDefined();
        });

        it('GET /api/users/me should reject expired/invalid JWT', async () => {
            await supertest(app.getHttpServer())
                .get('/api/users/me')
                .set('Authorization', 'Bearer invalid-token')
                .expect(401);
        });
    });

    // ─── I. Response format ───

    describe('Response format', () => {
        it('success responses should have { data: {...} } format', async () => {
            await createUserWithPassword('user@example.com', 'password123');

            const res = await supertest(app.getHttpServer())
                .post('/api/auth/check-email')
                .send({ email: 'user@example.com' })
                .expect(201);

            expect(res.body).toHaveProperty('data');
            expect(res.body).not.toHaveProperty('error');
        });

        it('error responses should have { error: { code, message } } format', async () => {
            const res = await supertest(app.getHttpServer())
                .get('/api/users/me')
                .expect(401);

            expect(res.body).toHaveProperty('error');
            expect(res.body.error).toHaveProperty('code');
            expect(res.body.error).toHaveProperty('message');
        });

        it('validation errors should return 400', async () => {
            const res = await supertest(app.getHttpServer())
                .post('/api/auth/magic-link/send')
                .send({})
                .expect(400);

            expect(res.body).toHaveProperty('error');
        });
    });

    // ─── Terms consent tracking ───

    describe('Terms consent tracking', () => {
        it('should record termsVersion on password login when provided', async () => {
            await createUserWithPassword('terms@example.com', 'Password123');

            const { accessToken } = await loginWithPassword(
                'terms@example.com',
                'Password123'
            );

            // Login endpoint now accepts termsVersion — re-login with it
            await supertest(app.getHttpServer())
                .post('/api/auth/login/password')
                .send({
                    email: 'terms@example.com',
                    password: 'Password123',
                    termsVersion: CURRENT_TERMS_VERSION,
                })
                .expect(201);

            const meRes = await supertest(app.getHttpServer())
                .get('/api/users/me')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(200);

            expect(meRes.body.data.termsVersion).toBe(CURRENT_TERMS_VERSION);
        });

        it('should not fail login when termsVersion is not provided', async () => {
            await createUserWithPassword('noterms@example.com', 'Password123');

            await supertest(app.getHttpServer())
                .post('/api/auth/login/password')
                .send({ email: 'noterms@example.com', password: 'Password123' })
                .expect(201);
        });

        it('should accept terms via dedicated endpoint', async () => {
            await createUserWithPassword('accept@example.com', 'Password123');
            const { accessToken } = await loginWithPassword(
                'accept@example.com',
                'Password123'
            );

            const res = await supertest(app.getHttpServer())
                .post('/api/users/me/accept-terms')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({ termsVersion: CURRENT_TERMS_VERSION })
                .expect(201);

            expect(res.body.data.code).toBe('TERMS_ACCEPTED');

            const meRes = await supertest(app.getHttpServer())
                .get('/api/users/me')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(200);

            expect(meRes.body.data.termsVersion).toBe(CURRENT_TERMS_VERSION);
        });

        it('should reject accept-terms with wrong version', async () => {
            await createUserWithPassword('wrong@example.com', 'Password123');
            const { accessToken } = await loginWithPassword(
                'wrong@example.com',
                'Password123'
            );

            await supertest(app.getHttpServer())
                .post('/api/users/me/accept-terms')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({ termsVersion: '2020-01-01' })
                .expect(400);
        });

        it('should expose termsVersion in getMe response', async () => {
            await createUserWithPassword('expose@example.com', 'Password123');
            const { accessToken } = await loginWithPassword(
                'expose@example.com',
                'Password123'
            );

            const res = await supertest(app.getHttpServer())
                .get('/api/users/me')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(200);

            expect(res.body.data).toHaveProperty('termsVersion');
        });
    });

    // ─── Password Reset flow ───

    describe('POST /auth/password/reset', () => {
        it('should reset password with valid token', async () => {
            await createUserWithPassword('user@example.com', 'OldPassword1');
            const token = createMagicLinkToken(
                'user@example.com',
                'reset-password'
            );

            const res = await supertest(app.getHttpServer())
                .post('/api/auth/password/reset')
                .send({
                    token,
                    newPassword: 'NewPassword1',
                    confirmPassword: 'NewPassword1',
                })
                .expect(201);

            const body = res.body as {
                data: { code: string; message: string };
            };
            expect(body.data.code).toBe('PASSWORD_RESET');

            // Response must NOT contain accessToken
            expect(body.data).not.toHaveProperty('accessToken');

            // Old password should no longer work
            await supertest(app.getHttpServer())
                .post('/api/auth/login/password')
                .send({ email: 'user@example.com', password: 'OldPassword1' })
                .expect(401);

            // New password should work
            await supertest(app.getHttpServer())
                .post('/api/auth/login/password')
                .send({ email: 'user@example.com', password: 'NewPassword1' })
                .expect(201);
        });

        it('should reject invalid token', async () => {
            await supertest(app.getHttpServer())
                .post('/api/auth/password/reset')
                .send({
                    token: 'invalid-token',
                    newPassword: 'NewPassword1',
                    confirmPassword: 'NewPassword1',
                })
                .expect(401);
        });

        it('should reject expired/used token (second use)', async () => {
            await createUserWithPassword('user@example.com', 'OldPassword1');
            const token = createMagicLinkToken(
                'user@example.com',
                'reset-password'
            );

            // First use — success
            await supertest(app.getHttpServer())
                .post('/api/auth/password/reset')
                .send({
                    token,
                    newPassword: 'NewPassword1',
                    confirmPassword: 'NewPassword1',
                })
                .expect(201);

            // Second use — GETDEL already consumed
            await supertest(app.getHttpServer())
                .post('/api/auth/password/reset')
                .send({
                    token,
                    newPassword: 'AnotherPwd1',
                    confirmPassword: 'AnotherPwd1',
                })
                .expect(401);
        });

        it('should reject token with wrong purpose', async () => {
            await createUserWithoutPassword('user@example.com');
            const token = createMagicLinkToken('user@example.com', 'login');

            await supertest(app.getHttpServer())
                .post('/api/auth/password/reset')
                .send({
                    token,
                    newPassword: 'NewPassword1',
                    confirmPassword: 'NewPassword1',
                })
                .expect(400);
        });

        it('should reject mismatched passwords', async () => {
            await createUserWithPassword('user@example.com', 'OldPassword1');
            const token = createMagicLinkToken(
                'user@example.com',
                'reset-password'
            );

            await supertest(app.getHttpServer())
                .post('/api/auth/password/reset')
                .send({
                    token,
                    newPassword: 'aaaaaaaa',
                    confirmPassword: 'bbbbbbbb',
                })
                .expect(400);
        });

        it('should reject short password', async () => {
            await createUserWithPassword('user@example.com', 'OldPassword1');
            const token = createMagicLinkToken(
                'user@example.com',
                'reset-password'
            );

            await supertest(app.getHttpServer())
                .post('/api/auth/password/reset')
                .send({
                    token,
                    newPassword: '123',
                    confirmPassword: '123',
                })
                .expect(400);
        });

        it('should revoke all existing sessions after reset', async () => {
            await createUserWithPassword('user@example.com', 'OldPassword1');

            // Login to get a refresh token
            const { cookies } = await loginWithPassword(
                'user@example.com',
                'OldPassword1'
            );
            const refreshToken = extractRefreshCookie(cookies);

            // Reset password
            const token = createMagicLinkToken(
                'user@example.com',
                'reset-password'
            );
            await supertest(app.getHttpServer())
                .post('/api/auth/password/reset')
                .send({
                    token,
                    newPassword: 'NewPassword1',
                    confirmPassword: 'NewPassword1',
                })
                .expect(201);

            // Old refresh token should be revoked
            await supertest(app.getHttpServer())
                .post('/api/auth/refresh')
                .set('Cookie', `bid_refresh=${refreshToken}`)
                .send({})
                .expect(401);
        });

        it('should work for OAuth-only user without existing password', async () => {
            await createUserWithoutPassword('oauth@example.com');
            const token = createMagicLinkToken(
                'oauth@example.com',
                'reset-password'
            );

            await supertest(app.getHttpServer())
                .post('/api/auth/password/reset')
                .send({
                    token,
                    newPassword: 'NewPassword1',
                    confirmPassword: 'NewPassword1',
                })
                .expect(201);

            // Should now be able to login with password
            await supertest(app.getHttpServer())
                .post('/api/auth/login/password')
                .send({
                    email: 'oauth@example.com',
                    password: 'NewPassword1',
                })
                .expect(201);
        });
    });
});
