import { ConflictException } from '@nestjs/common';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';

import {
    RedisLockBusyError,
    RedisLockService,
} from '../../common/services/redis-lock.service';
import { createStandaloneMongo } from '../../test-utils/mongo';
import {
    SlugReservation,
    SlugReservationDocument,
    SlugReservationSchema,
} from './schemas/slug-reservation.schema';
import { SlugReservationService } from './slug-reservation.service';

/**
 * Sprint 20 — життєвий цикл броні slug на реальному (in-memory) Mongo:
 * створення, інваріант «одна на користувача», конфлікт scope-унікальності,
 * блокування чужою бронню, сплив (через `expiresAt > now`, не лінивий TTL),
 * споживання. Транзакції тут не потрібні (reserve — delete-first + insert під
 * Redis-локом), тож standalone-Mongo достатній.
 */
describe('SlugReservationService (Sprint 20, MongoMemoryServer)', () => {
    let mongo: Awaited<ReturnType<typeof createStandaloneMongo>>;
    let moduleRef: TestingModule;
    let service: SlugReservationService;
    let model: Model<SlugReservationDocument>;

    const userA = new Types.ObjectId();
    const userB = new Types.ObjectId();
    const targetA = new Types.ObjectId();
    const targetB = new Types.ObjectId();
    const SCOPE = SlugReservationService.businessScopeKey();

    // Фейк-лок: критична секція виконується напряму (Redis у unit-spec немає).
    const fakeLock = {
        withLock: <T>(_k: string, _t: number, fn: () => Promise<T>) => fn(),
    };

    const baseParams = (
        userId: Types.ObjectId,
        targetId: Types.ObjectId,
        slug: string
    ) => ({
        userId,
        entityType: 'business' as const,
        targetId,
        scopeKey: SCOPE,
        slug,
        businessSlug: 'current-slug',
        accountSlug: null,
        invoiceSlug: null,
    });

    beforeAll(async () => {
        mongo = await createStandaloneMongo();
        moduleRef = await Test.createTestingModule({
            imports: [
                MongooseModule.forRoot(mongo.uri),
                MongooseModule.forFeature([
                    {
                        name: SlugReservation.name,
                        schema: SlugReservationSchema,
                    },
                ]),
            ],
            providers: [
                SlugReservationService,
                { provide: RedisLockService, useValue: fakeLock },
            ],
        }).compile();

        service = moduleRef.get(SlugReservationService);
        model = moduleRef.get(getModelToken(SlugReservation.name));
        await model.syncIndexes();
    });

    afterAll(async () => {
        await moduleRef.close();
        await mongo.stop();
    });

    afterEach(async () => {
        await model.deleteMany({});
    });

    it("reserve кладе ім'я на холд з expiresAt ~15 хв у майбутньому", async () => {
        const before = Date.now();
        const doc = await service.reserve(baseParams(userA, targetA, 'Acme'));
        expect(doc.slug).toBe('Acme');
        expect(doc.slugLower).toBe('acme');
        const ttlMs = doc.expiresAt.getTime() - before;
        expect(ttlMs).toBeGreaterThan(14 * 60 * 1000);
        expect(ttlMs).toBeLessThanOrEqual(15 * 60 * 1000 + 1000);
    });

    it('одна активна бронь на користувача — нова звільняє попередню', async () => {
        await service.reserve(baseParams(userA, targetA, 'first-name'));
        await service.reserve(baseParams(userA, targetA, 'second-name'));
        const all = await model.find({ userId: userA });
        expect(all).toHaveLength(1);
        expect(all[0].slugLower).toBe('second-name');
    });

    it("чужа активна бронь на те саме ім'я → SLUG_TAKEN", async () => {
        await service.reserve(baseParams(userA, targetA, 'contested'));
        await expect(
            service.reserve(baseParams(userB, targetB, 'contested'))
        ).rejects.toMatchObject({
            response: { code: 'SLUG_TAKEN' },
        });
        await expect(
            service.reserve(baseParams(userB, targetB, 'CONTESTED'))
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('isNameHeldByOther: true для чужої активної, false для власної', async () => {
        await service.reserve(baseParams(userA, targetA, 'mine'));
        await expect(
            service.isNameHeldByOther(SCOPE, 'mine', userB)
        ).resolves.toBe(true);
        // Власна бронь не блокує власника (її споживе rename).
        await expect(
            service.isNameHeldByOther(SCOPE, 'mine', userA)
        ).resolves.toBe(false);
        await expect(
            service.isNameHeldByOther(SCOPE, 'free', userB)
        ).resolves.toBe(false);
    });

    it('сплила бронь не блокує і не повертається як активна', async () => {
        await model.create({
            ...baseParams(userA, targetA, 'expired'),
            slugLower: 'expired',
            expiresAt: new Date(Date.now() - 60 * 1000),
        });
        await expect(
            service.isNameHeldByOther(SCOPE, 'expired', userB)
        ).resolves.toBe(false);
        await expect(service.getActiveForUser(userA)).resolves.toBeNull();
    });

    it('reserve прибирає сплилий хвіст того самого імені і дозволяє новий холд', async () => {
        await model.create({
            ...baseParams(userB, targetB, 'recycled'),
            slugLower: 'recycled',
            expiresAt: new Date(Date.now() - 60 * 1000),
        });
        const doc = await service.reserve(
            baseParams(userA, targetA, 'recycled')
        );
        expect(doc.userId.toString()).toBe(userA.toString());
        const rows = await model.find({
            scopeKey: SCOPE,
            slugLower: 'recycled',
        });
        expect(rows).toHaveLength(1);
    });

    it('getActiveForUser повертає активну бронь', async () => {
        await service.reserve(baseParams(userA, targetA, 'active-one'));
        const active = await service.getActiveForUser(userA);
        expect(active?.slugLower).toBe('active-one');
    });

    it('consumeForUser видаляє бронь користувача', async () => {
        await service.reserve(baseParams(userA, targetA, 'to-consume'));
        await service.consumeForUser(userA);
        await expect(service.getActiveForUser(userA)).resolves.toBeNull();
    });

    // Лок зайнятий N перших викликів, далі делегує fn (симуляція конкурентного
    // self-reserve, що тримає per-user лок). Власний інстанс сервісу, бо лок
    // інжектиться у конструктор.
    class ProgrammableLock {
        failsLeft = Number.POSITIVE_INFINITY;
        calls = 0;
        async withLock<T>(
            key: string,
            _ttl: number,
            fn: () => Promise<T>
        ): Promise<T> {
            this.calls++;
            if (this.failsLeft > 0) {
                this.failsLeft--;
                throw new RedisLockBusyError(key);
            }
            return fn();
        }
    }

    it('reserve ретраїть на зайнятому локу і зрештою кладе бронь', async () => {
        const lock = new ProgrammableLock();
        lock.failsLeft = 2; // перші 2 спроби — busy, 3-тя проходить
        const svc = new SlugReservationService(
            model,
            lock as unknown as RedisLockService
        );

        const doc = await svc.reserve(baseParams(userA, targetA, 'retry-win'));

        expect(doc.slugLower).toBe('retry-win');
        expect(lock.calls).toBe(3);
    });

    it('reserve вичерпав ретраї на локу → SLUG_RESERVATION_IN_PROGRESS, нічого не записано', async () => {
        const lock = new ProgrammableLock(); // failsLeft = Infinity → усі спроби busy
        const svc = new SlugReservationService(
            model,
            lock as unknown as RedisLockService
        );

        await expect(
            svc.reserve(baseParams(userA, targetA, 'never-acquired'))
        ).rejects.toMatchObject({
            response: { code: 'SLUG_RESERVATION_IN_PROGRESS' },
        });
        await expect(service.getActiveForUser(userA)).resolves.toBeNull();
    });
});
