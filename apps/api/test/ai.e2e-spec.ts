import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import * as cookieParser from 'cookie-parser';
import * as supertest from 'supertest';
import { App } from 'supertest/types';
import { ZodValidationPipe } from 'nestjs-zod';
import { Readable } from 'stream';
import * as http from 'http';
import { Model } from 'mongoose';
import { createHmac } from 'crypto';

import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { RedisModule, REDIS_CLIENT } from '../src/common/modules/redis.module';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { AuthModule } from '../src/modules/auth/auth.module';
import { EmailModule } from '../src/modules/email/email.module';
import { UsersModule } from '../src/modules/users/users.module';
import { AiModule } from '../src/modules/ai/ai.module';
import { User, UserDocument } from '../src/modules/users/schemas/user.schema';
import {
    ExecutionTransaction,
    ExecutionTransactionDocument,
} from '../src/modules/users/schemas/execution-transaction.schema';
import {
    ChatMessage,
    ChatMessageDocument,
} from '../src/modules/ai/schemas/chat-message.schema';
import { EmailService } from '../src/modules/email/email.service';
import { AI_PROVIDER } from '../src/modules/ai/interfaces/ai-provider.interface';
import { ReservationReconcileService } from '../src/modules/users/reservation-reconcile.service';

// ─── Mock ENV ────────────────────────────────────────────────────────────────

jest.mock('../src/config/env', () => ({
    ENV: {
        NODE_ENV: 'test',
        PORT: '4000',
        WEB_URL: 'http://localhost:3000',
        MONGODB_URI: 'overridden-by-MongoMemoryReplSet',
        REDIS_URL: 'redis://mock',
        JWT_ACCESS_SECRET: 'e2e-test-access-secret-must-be-long-enough',
        JWT_REFRESH_SECRET: 'e2e-test-refresh-secret-must-be-long-enough',
        GOOGLE_CLIENT_ID: 'test-id.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'GOCSPX-test-secret',
        GOOGLE_CALLBACK_URL: 'http://localhost:4000/api/auth/google/callback',
        RESEND_API_KEY: 're_test_key',
        RESEND_FROM_EMAIL: 'CyanShip <test@test.com>',
        AUTH_LOCKOUT_THRESHOLDS: '5:1,10:5,20:15',
        AUTH_LOGIN_ATTEMPTS_TTL_MIN: 15,
        AUTH_MAGIC_LINK_TTL_MIN: 15,
        AUTH_MAGIC_LINK_RATE_LIMIT: 3,
        AUTH_MAGIC_LINK_RATE_WINDOW_MIN: 15,
        AUTH_MAGIC_LINK_DEDUP_SEC: 60,
        ACCOUNT_DELETION_GRACE_DAYS: 30,
        AUTH_PASSWORD_MIN_LENGTH: 8,
        STRIPE_SECRET_KEY: 'sk_test_xxx',
        STRIPE_WEBHOOK_SECRET: 'whsec_test',
        PAYMENTS_SUBSCRIPTION_ENABLED: true,
        PAYMENTS_ONE_OFF_ENABLED: true,
        ANTHROPIC_API_KEY: 'test-key',
        AI_CHAT_MAX_TOKENS: 800,
        AI_CHAT_IP_LIMIT: 100,
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

    const mock = {
        get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
        set: jest.fn(
            (key: string, value: string, _ex?: string, _ttl?: number) => {
                store.set(key, value);
                return Promise.resolve('OK');
            }
        ),
        del: jest.fn((key: string) => {
            store.delete(key);
            return Promise.resolve(1);
        }),
        getdel: jest.fn((key: string) => {
            const val = store.get(key) ?? null;
            store.delete(key);
            return Promise.resolve(val);
        }),
        eval: jest.fn(
            (_script: string, _numKeys: number, key: string, ttl: string) => {
                const current = parseInt(store.get(key) ?? '0', 10) + 1;
                store.set(key, String(current));
                if (current === 1 && ttl) {
                    /* TTL ignored in mock */
                }
                return Promise.resolve(current);
            }
        ),
        pipeline: jest.fn(() => {
            const ops: Array<() => void> = [];
            const pipe = {
                set(key: string, value: string) {
                    ops.push(() => store.set(key, value));
                    return pipe;
                },
                del(key: string) {
                    ops.push(() => store.delete(key));
                    return pipe;
                },
                exec: jest.fn(() => {
                    ops.forEach((op) => op());
                    return Promise.resolve(ops.map(() => [null, 'OK']));
                }),
            };
            return pipe;
        }),
        keys: jest.fn((pattern: string) => {
            const prefix = pattern.replace('*', '');
            return Promise.resolve(
                [...store.keys()].filter((k) => k.startsWith(prefix))
            );
        }),
        ping: jest.fn(() => Promise.resolve('PONG')),
        quit: jest.fn(() => Promise.resolve('OK')),
        _clear: () => store.clear(),
    };
    return mock;
}

// ─── Mock AI provider ────────────────────────────────────────────────────────

const mockAiProvider = {
    contextWindow: 200_000,
    countTokens: jest.fn().mockResolvedValue(500),
    streamChat: jest.fn(() =>
        Promise.resolve(Readable.from(['Hello', ' world', '!']))
    ),
};

const mockEmailService = {
    sendMagicLink: jest.fn().mockResolvedValue(undefined),
    sendDeletionConfirmation: jest.fn().mockResolvedValue(undefined),
    sendDeletionReminder: jest.fn().mockResolvedValue(undefined),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createUser(
    userModel: Model<UserDocument>,
    overrides: Record<string, unknown> = {}
) {
    return userModel.create({
        email: `test-${Date.now()}@test.com`,
        preferredLang: 'en',
        executions: {
            balance: 1000,
            freeReportUsed: false,
            activeReservation: null,
        },
        profile: { firstName: 'Test' },
        termsAcceptedAt: new Date(),
        termsVersion: '1.0',
        ...overrides,
    });
}

function getAccessToken(_app: INestApplication<App>, userId: string): string {
    const header = Buffer.from(
        JSON.stringify({ alg: 'HS256', typ: 'JWT' })
    ).toString('base64url');
    const payload = Buffer.from(
        JSON.stringify({
            sub: userId,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 900,
        })
    ).toString('base64url');
    const signature = createHmac(
        'sha256',
        'e2e-test-access-secret-must-be-long-enough'
    )
        .update(`${header}.${payload}`)
        .digest('base64url');
    return `${header}.${payload}.${signature}`;
}

function parseSSEEvents(body: string): Array<Record<string, unknown>> {
    return body
        .split('\n\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.replace('data: ', '')));
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('AI Chat E2E', () => {
    let app: INestApplication<App>;
    let mongoServer: MongoMemoryReplSet;
    let userModel: Model<UserDocument>;
    let transactionModel: Model<ExecutionTransactionDocument>;
    let chatMessageModel: Model<ChatMessageDocument>;
    let reconcileService: ReservationReconcileService;
    let redisMock: ReturnType<typeof createStatefulRedisMock>;

    beforeAll(async () => {
        mongoServer = await MongoMemoryReplSet.create({
            replSet: { count: 1 },
        });
        redisMock = createStatefulRedisMock();

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true }),
                ThrottlerModule.forRoot({
                    throttlers: [{ ttl: 60000, limit: 600 }],
                }),
                ScheduleModule.forRoot(),
                MongooseModule.forRoot(mongoServer.getUri()),
                RedisModule,
                AuthModule,
                EmailModule,
                UsersModule,
                AiModule,
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
            .overrideProvider(AI_PROVIDER)
            .useValue(mockAiProvider)
            .compile();

        app = moduleFixture.createNestApplication({ rawBody: true });
        app.use(cookieParser());
        app.setGlobalPrefix('api');
        app.useGlobalPipes(new ZodValidationPipe());
        app.useGlobalFilters(new AllExceptionsFilter());
        await app.init();
        await app.listen(0); // Random port for raw HTTP abort tests

        userModel = moduleFixture.get<Model<UserDocument>>(
            getModelToken(User.name)
        );
        transactionModel = moduleFixture.get<
            Model<ExecutionTransactionDocument>
        >(getModelToken(ExecutionTransaction.name));
        chatMessageModel = moduleFixture.get<Model<ChatMessageDocument>>(
            getModelToken(ChatMessage.name)
        );
        reconcileService = moduleFixture.get(ReservationReconcileService);
    }, 120_000);

    afterAll(async () => {
        await app.close();
        await mongoServer.stop();
    });

    beforeEach(async () => {
        redisMock._clear();
        mockAiProvider.streamChat.mockImplementation(() =>
            Promise.resolve(Readable.from(['Hello', ' world', '!']))
        );
        await userModel.deleteMany({});
        await transactionModel.deleteMany({});
        await chatMessageModel.deleteMany({});
    });

    describe('Single request sanity', () => {
        it('should complete happy path: reserve → stream → commit → DONE', async () => {
            const user = await createUser(userModel);
            const token = getAccessToken(app, user._id.toString());

            const res = await supertest(app.getHttpServer())
                .post('/api/ai/chat')
                .set('Authorization', `Bearer ${token}`)
                .send({ message: 'Hello AI' });

            const events = parseSSEEvents(res.text);
            const doneEvent = events.find((e) => e.type === 'done');

            expect(doneEvent).toBeDefined();
            expect(doneEvent!.balanceAfter).toBe(800); // 1000 - 200

            // Verify DB state
            const updatedUser = await userModel.findById(user._id);
            expect(updatedUser!.executions.balance).toBe(800);
            expect(updatedUser!.executions.activeReservation).toBeNull();

            // Verify ledger
            const txns = await transactionModel.find({ userId: user._id });
            expect(txns).toHaveLength(1);
            expect(txns[0].action).toBe('ai_chat');
            expect(txns[0].amount).toBe(200);
            expect(txns[0].reservationId).toBeDefined();

            // Verify history
            const messages = await chatMessageModel.find({ userId: user._id });
            expect(messages).toHaveLength(2);
            expect(messages[0].role).toBe('user');
            expect(messages[1].role).toBe('assistant');
            expect(messages[1].content).toBe('Hello world!');
        });
    });

    describe('Race on balance', () => {
        it('should allow exactly 1 of 5 parallel requests when balance = AI_CHAT_COST', async () => {
            const user = await createUser(userModel, {
                executions: {
                    balance: 200,
                    freeReportUsed: false,
                    activeReservation: null,
                },
            });
            const token = getAccessToken(app, user._id.toString());

            const results = await Promise.allSettled(
                Array.from({ length: 5 }, () =>
                    supertest(app.getHttpServer())
                        .post('/api/ai/chat')
                        .set('Authorization', `Bearer ${token}`)
                        .send({ message: 'Race test' })
                )
            );

            const responses = results
                .filter(
                    (r): r is PromiseFulfilledResult<supertest.Response> =>
                        r.status === 'fulfilled'
                )
                .map((r) => r.value);

            const successes = responses.filter((r) =>
                r.text.includes('"type":"done"')
            );
            const failures = responses.filter(
                (r) => !r.text.includes('"type":"done"')
            );

            expect(successes).toHaveLength(1);
            expect(failures).toHaveLength(4);

            // Non-200 failures should be 400 (INSUFFICIENT) or 409 (RESERVATION_ACTIVE)
            for (const fail of failures.filter((r) => r.status !== 200)) {
                expect([400, 409]).toContain(fail.status);
            }

            // DB: balance=0, reservation cleared
            const updatedUser = await userModel.findById(user._id);
            expect(updatedUser!.executions.balance).toBe(0);
            expect(updatedUser!.executions.activeReservation).toBeNull();

            // Exactly 1 ledger entry
            const txns = await transactionModel.find({ userId: user._id });
            expect(txns).toHaveLength(1);
        });
    });

    describe('Cron reconcile', () => {
        it('should refund expired reservation', async () => {
            // Create user with an expired reservation (manually set)
            const user = await createUser(userModel, {
                executions: {
                    balance: 800,
                    freeReportUsed: false,
                    activeReservation: {
                        id: 'expired-reservation-id',
                        amount: 200,
                        reservedAt: new Date(Date.now() - 600_000),
                        expiresAt: new Date(Date.now() - 60_000), // expired 1 min ago
                        feature: 'ai_chat',
                        compensationOps: { inc: {} },
                    },
                },
            });

            await reconcileService.reconcileExpiredReservations();

            const updatedUser = await userModel.findById(user._id);
            expect(updatedUser!.executions.activeReservation).toBeNull();
            expect(updatedUser!.executions.balance).toBe(1000); // 800 + 200 restored
        });
    });

    describe('Stale commit detection', () => {
        it('should not create ledger entry when reservation was already cleared', async () => {
            const user = await createUser(userModel);
            const token = getAccessToken(app, user._id.toString());

            // Slow provider: gives time to manipulate DB between reserve and commit
            mockAiProvider.streamChat.mockImplementation(async () => {
                // Simulate reservation cleared by cron between reserve and stream
                await userModel.findByIdAndUpdate(user._id, {
                    $set: { 'executions.activeReservation': null },
                });
                return Readable.from(['chunk']);
            });

            const res = await supertest(app.getHttpServer())
                .post('/api/ai/chat')
                .set('Authorization', `Bearer ${token}`)
                .send({ message: 'Stale test' });

            // Should get SSE ERROR (commit fails due to stale reservation)
            const events = parseSSEEvents(res.text);
            const errorEvent = events.find((e) => e.type === 'error');
            expect(errorEvent).toBeDefined();

            // No ledger entry
            const txns = await transactionModel.find({ userId: user._id });
            expect(txns).toHaveLength(0);
        });
    });

    describe('Double refund safety', () => {
        it('should restore balance exactly once on double refund', async () => {
            const user = await createUser(userModel, {
                executions: {
                    balance: 800,
                    freeReportUsed: false,
                    activeReservation: {
                        id: 'double-refund-id',
                        amount: 200,
                        reservedAt: new Date(),
                        expiresAt: new Date(Date.now() + 300_000),
                        feature: 'ai_chat',
                        compensationOps: { inc: {} },
                    },
                },
            });

            // Get UsersService and call refund twice
            const { UsersService } =
                await import('../src/modules/users/users.service');
            const usersService = app.get(UsersService);

            await usersService.refundReservation(
                user._id.toString(),
                'double-refund-id'
            );
            await usersService.refundReservation(
                user._id.toString(),
                'double-refund-id'
            );

            const updatedUser = await userModel.findById(user._id);
            expect(updatedUser!.executions.balance).toBe(1000); // 800 + 200 (once)
            expect(updatedUser!.executions.activeReservation).toBeNull();
        });
    });

    describe('Client abort before first token', () => {
        it('should refund: balance restored, no ledger/history', async () => {
            const user = await createUser(userModel);
            const token = getAccessToken(app, user._id.toString());

            // Controlled stream: hangs until we push data
            let streamResolve: (stream: Readable) => void;
            const streamPromise = new Promise<Readable>((resolve) => {
                streamResolve = resolve;
            });
            mockAiProvider.streamChat.mockImplementation(() => streamPromise);

            const address = (app.getHttpServer() as http.Server).address() as {
                port: number;
            };
            const port = address.port;

            // Make raw HTTP request so we can destroy it mid-flight
            const body = JSON.stringify({ message: 'Abort before token' });
            const abortedResponse = await new Promise<string>((resolve) => {
                const req = http.request(
                    {
                        hostname: '127.0.0.1',
                        port,
                        path: '/api/ai/chat',
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${token}`,
                            'Content-Length': Buffer.byteLength(body),
                        },
                    },
                    (res) => {
                        let data = '';
                        res.on('data', (chunk) => {
                            data += chunk;
                        });
                        res.on('end', () => resolve(data));
                        res.on('error', () => resolve(data));

                        // Once SSE headers arrive, abort before any token
                        // Give a tick for the controller to set up the close listener
                        setTimeout(() => req.destroy(), 50);
                    }
                );
                req.write(body);
                req.end();

                // Resolve the provider stream after request is made but make it slow
                const controlledStream = new Readable({ read() {} });
                streamResolve!(controlledStream);

                // After destroy, push null to unblock any remaining reads
                setTimeout(() => {
                    controlledStream.push(null);
                }, 200);
            });

            // Wait for server-side finally block to complete
            await new Promise((r) => setTimeout(r, 500));

            // Verify DB state: fully refunded
            const updatedUser = await userModel.findById(user._id);
            expect(updatedUser!.executions.balance).toBe(1000); // restored
            expect(updatedUser!.executions.activeReservation).toBeNull();

            // No ledger entry
            const txns = await transactionModel.find({ userId: user._id });
            expect(txns).toHaveLength(0);

            // No chat history
            const messages = await chatMessageModel.find({ userId: user._id });
            expect(messages).toHaveLength(0);
        });
    });

    describe('Client abort after first token', () => {
        it('should commit (non-refundable): balance debited, ledger+history present', async () => {
            const user = await createUser(userModel);
            const token = getAccessToken(app, user._id.toString());

            // Controlled stream: delivers first chunk immediately, then waits
            let streamResolve: (stream: Readable) => void;
            const streamPromise = new Promise<Readable>((resolve) => {
                streamResolve = resolve;
            });
            mockAiProvider.streamChat.mockImplementation(() => streamPromise);

            const address = (app.getHttpServer() as http.Server).address() as {
                port: number;
            };
            const port = address.port;

            const body = JSON.stringify({ message: 'Abort after token' });
            await new Promise<string>((resolve) => {
                let firstTokenSeen = false;
                const req = http.request(
                    {
                        hostname: '127.0.0.1',
                        port,
                        path: '/api/ai/chat',
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${token}`,
                            'Content-Length': Buffer.byteLength(body),
                        },
                    },
                    (res) => {
                        let data = '';
                        res.on('data', (chunk) => {
                            data += chunk;
                            // Once we see a TOKEN event, abort
                            if (
                                !firstTokenSeen &&
                                data.includes('"type":"token"')
                            ) {
                                firstTokenSeen = true;
                                setTimeout(() => req.destroy(), 20);
                            }
                        });
                        res.on('end', () => resolve(data));
                        res.on('error', () => resolve(data));
                    }
                );
                req.write(body);
                req.end();

                // Resolve provider with a stream that sends first chunk then pauses
                const controlledStream = new Readable({ read() {} });
                streamResolve!(controlledStream);

                // Push first chunk to trigger firstTokenReceived in controller
                setTimeout(() => controlledStream.push('Partial response'), 50);
                // End stream after abort to let controller exit cleanly
                setTimeout(() => controlledStream.push(null), 300);
            });

            // Wait for server-side commit in finally block
            await new Promise((r) => setTimeout(r, 500));

            // Verify DB state: committed (non-refundable)
            const updatedUser = await userModel.findById(user._id);
            expect(updatedUser!.executions.balance).toBe(800); // 1000 - 200, NOT restored
            expect(updatedUser!.executions.activeReservation).toBeNull();

            // 1 ledger entry
            const txns = await transactionModel.find({ userId: user._id });
            expect(txns).toHaveLength(1);
            expect(txns[0].action).toBe('ai_chat');

            // History with partial content
            const messages = await chatMessageModel
                .find({ userId: user._id })
                .sort({ createdAt: 1 });
            expect(messages).toHaveLength(2);
            expect(messages[0].role).toBe('user');
            expect(messages[1].role).toBe('assistant');
            expect(messages[1].content).toBe('Partial response');
        });
    });
});
