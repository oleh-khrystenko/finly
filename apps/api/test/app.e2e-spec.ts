import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { ZodValidationPipe } from 'nestjs-zod';

import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { REDIS_CLIENT, RedisModule } from '../src/common/modules/redis.module';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { AuthModule } from '../src/modules/auth/auth.module';
import { EmailModule } from '../src/modules/email/email.module';
import { LandingClaimModule } from '../src/modules/landing-claim/landing-claim.module';
import { UsersModule } from '../src/modules/users/users.module';
import { ReportsModule } from '../src/modules/reports/reports.module';
import { StorageModule } from '../src/modules/storage/storage.module';
import { PaymentsModule } from '../src/modules/payments/payments.module';

// Mock ENV to prevent fail-fast crash on missing env vars
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
    },
}));

const mockPipeline = {
    set: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    incr: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    sadd: jest.fn().mockReturnThis(),
    srem: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
};

const mockRedis = {
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    getdel: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    smembers: jest.fn().mockResolvedValue([]),
    pipeline: jest.fn().mockReturnValue(mockPipeline),
    on: jest.fn().mockReturnThis(),
    // Lua-лічильники RedisCounterService (lockout/rate-limit): достатньо
    // повертати 1 — лімітів цей suite не тестує.
    eval: jest.fn().mockResolvedValue(1),
};

describe('App (e2e)', () => {
    let app: INestApplication<App>;
    let mongoServer: MongoMemoryServer;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true }),
                ThrottlerModule.forRoot({
                    throttlers: [{ ttl: 60000, limit: 60 }],
                }),
                MongooseModule.forRoot(mongoServer.getUri()),
                // @Global-модулі реального AppModule: у тест-композиції globals
                // реєструються лише якщо модуль присутній у графі. Без
                // RedisModule токен REDIS_CLIENT не існує (override нічого не
                // перекриває), без EmailModule CleanupService (UsersModule) не
                // отримує EmailService.
                RedisModule,
                EmailModule,
                AuthModule,
                UsersModule,
                ReportsModule,
                StorageModule,
                PaymentsModule,
                // POST /auth/magic-link/verify живе у MagicLinkVerifyController
                // (LandingClaimModule, Sprint 13) — без імпорту маршрут 404.
                LandingClaimModule,
            ],
            controllers: [AppController],
            providers: [
                AppService,
                { provide: APP_GUARD, useClass: ThrottlerGuard },
            ],
        })
            .overrideProvider(REDIS_CLIENT)
            .useValue(mockRedis)
            .compile();

        app = moduleFixture.createNestApplication();
        app.use(cookieParser());
        app.setGlobalPrefix('api');
        app.useGlobalPipes(new ZodValidationPipe());
        app.useGlobalFilters(new AllExceptionsFilter());
        await app.init();
    }, 60_000);

    afterAll(async () => {
        await app.close();
        await mongoServer.stop();
    });

    describe('GET /api', () => {
        it('should return Hello World', () => {
            return request(app.getHttpServer())
                .get('/api')
                .expect(200)
                .expect('Hello World!');
        });
    });

    describe('GET /api/health', () => {
        it('should return health status', () => {
            return request(app.getHttpServer())
                .get('/api/health')
                .expect(200)
                .expect((res: request.Response) => {
                    const body = res.body as {
                        status: string;
                        timestamp: string;
                        environment: string;
                    };
                    expect(body).toMatchObject({
                        status: 'ok',
                        environment: 'test',
                    });
                    expect(body.timestamp).toBeDefined();
                });
        });
    });

    describe('Auth endpoints', () => {
        it('POST /api/auth/magic-link/send should require email', () => {
            return request(app.getHttpServer())
                .post('/api/auth/magic-link/send')
                .send({})
                .expect(400);
        });

        it('POST /api/auth/magic-link/verify should reject invalid token', () => {
            return request(app.getHttpServer())
                .post('/api/auth/magic-link/verify')
                .send({ token: 'a'.repeat(64) })
                .expect(401);
        });

        it('POST /api/auth/refresh should reject when no cookie', () => {
            return (
                request(app.getHttpServer())
                    .post('/api/auth/refresh')
                    // Порожній JSON-body: без нього Express 5 лишає req.body
                    // undefined і Zod відповідає 400 ще до cookie-перевірки.
                    .send({})
                    .expect(401)
            );
        });

        it('POST /api/auth/logout should succeed without cookie', () => {
            return request(app.getHttpServer())
                .post('/api/auth/logout')
                .expect(201)
                .expect((res: request.Response) => {
                    const body = res.body as {
                        data: { message: string };
                    };
                    expect(body.data.message).toBe('Logged out');
                });
        });
    });

    describe('Users endpoints', () => {
        it('GET /api/users/me should require auth', () => {
            return request(app.getHttpServer())
                .get('/api/users/me')
                .expect(401);
        });
    });
});
