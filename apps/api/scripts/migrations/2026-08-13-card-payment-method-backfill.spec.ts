import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { PAYMENT_RECORD_STATUS } from '@finly/types';

import {
    BILLING_PROFILES_COLLECTION,
    PAYMENT_RECORDS_COLLECTION,
    runMigration,
} from './2026-08-13-card-payment-method-backfill';

/**
 * Migration spec — беквіл способу оплати з monobank.
 *
 * Покриває:
 *  (а) відповідь провайдера осідає на списанні і на профілі, маска профілю ціла;
 *  (б) «оплати немає» — фінально, запис лишається без способу;
 *  (в) збій провайдера відкладає ПРОФІЛЬ цього платника (інакше на профіль сів
 *      би спосіб із давнішої оплати, і наступний прогін його вже не побачив би);
 *  (г) відмова у доступі зупиняє прогін, а не збирає звіт із фальшивих «немає»;
 *  (д) `wallet` не є джерелом для профілю — це списання збереженим токеном;
 *  (е) idempotent: повторний прогін нічого не перепитує.
 */

type FetchMock = jest.Mock<
    Promise<Response>,
    [RequestInfo | URL, RequestInit?]
>;

const TOKEN = 'test-token';

/** Відповідь monobank у тій формі, у якій її читає скрипт. */
function reply(status: number, body: unknown): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    } as unknown as Response;
}

function paymentInfo(overrides: Record<string, unknown> = {}): unknown {
    return {
        paymentInfo: {
            maskedPan: '444455******1111',
            paymentMethod: 'apple',
            paymentSystem: 'visa',
            bank: 'ПриватБанк',
            ...overrides,
        },
    };
}

describe('migration 2026-08-13-card-payment-method-backfill', () => {
    let mongoServer: MongoMemoryServer;
    let fetchMock: FetchMock;
    const realFetch = global.fetch;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        await mongoose.connect(mongoServer.getUri());
    }, 60_000);

    // Зупинка тимчасової БД зрідка не встигає у дефолтні 5 с — тоді падав би
    // весь suite при зелених тестах.
    afterAll(async () => {
        global.fetch = realFetch;
        await mongoose.disconnect();
        await mongoServer.stop();
    }, 30_000);

    beforeEach(() => {
        fetchMock = jest.fn() as FetchMock;
        global.fetch = fetchMock as unknown as typeof fetch;
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        const db = mongoose.connection.db!;
        for (const name of [
            PAYMENT_RECORDS_COLLECTION,
            BILLING_PROFILES_COLLECTION,
        ]) {
            const existing = await db.listCollections({ name }).toArray();
            if (existing.length > 0) await db.collection(name).drop();
        }
    });

    /** Прогін без пауз між запитами — вони тут нічого не перевіряють. */
    const run = () => runMigration(mongoose.connection.db!, TOKEN, 0);

    async function seed(
        userId: mongoose.Types.ObjectId,
        records: Record<string, unknown>[],
        profile: Record<string, unknown> | null = { cardMask: '** 2222' }
    ): Promise<void> {
        const db = mongoose.connection.db!;
        await db.collection(PAYMENT_RECORDS_COLLECTION).insertMany(
            records.map((record, index) => ({
                userId,
                amount: 10000,
                currency: 'UAH',
                createdAt: new Date(2026, 0, index + 1),
                ...record,
            }))
        );
        if (profile) {
            await db
                .collection(BILLING_PROFILES_COLLECTION)
                .insertOne({ userId, ...profile });
        }
    }

    it('переносить дані картки на списання і на профіль, не чіпаючи маску профілю', async () => {
        const userId = new mongoose.Types.ObjectId();
        await seed(userId, [
            {
                providerTransactionId: 'inv-1',
                status: PAYMENT_RECORD_STATUS.APPROVED,
                cardMask: '** 1111',
            },
        ]);
        fetchMock.mockResolvedValueOnce(reply(200, paymentInfo()));

        expect(await run()).toEqual({
            recordsResolved: 1,
            recordsNotFound: 0,
            recordsFailed: 0,
            profilesUpdated: 1,
            profilesDeferred: 0,
        });

        const db = mongoose.connection.db!;
        const record = await db
            .collection(PAYMENT_RECORDS_COLLECTION)
            .findOne({ providerTransactionId: 'inv-1' });
        expect(record).toMatchObject({
            cardMask: '444455******1111',
            cardPaymentMethod: 'apple',
            cardPaymentSystem: 'visa',
            cardBank: 'ПриватБанк',
        });

        const profile = await db
            .collection(BILLING_PROFILES_COLLECTION)
            .findOne({ userId });
        expect(profile).toMatchObject({
            // Маска профілю — від найсвіжішої оплати, її веде рантайм; беквіл
            // додає лише опис картки.
            cardMask: '** 2222',
            cardPaymentMethod: 'apple',
            cardPaymentSystem: 'visa',
            cardBank: 'ПриватБанк',
        });
    });

    it('«оплати немає» — фінально: запис лишається без способу оплати', async () => {
        const userId = new mongoose.Types.ObjectId();
        await seed(userId, [
            {
                providerTransactionId: 'inv-gone',
                status: PAYMENT_RECORD_STATUS.APPROVED,
            },
        ]);
        fetchMock.mockResolvedValueOnce(reply(404, { errCode: 'NOT_FOUND' }));

        expect(await run()).toMatchObject({
            recordsResolved: 0,
            recordsNotFound: 1,
            recordsFailed: 0,
            profilesUpdated: 0,
            profilesDeferred: 0,
        });

        const record = await mongoose.connection
            .db!.collection(PAYMENT_RECORDS_COLLECTION)
            .findOne({ providerTransactionId: 'inv-gone' });
        expect(record!.cardPaymentMethod).toBeUndefined();
    });

    it('збій провайдера відкладає профіль платника, а не бере давнішу оплату', async () => {
        const userId = new mongoose.Types.ObjectId();
        await seed(userId, [
            {
                providerTransactionId: 'inv-old',
                status: PAYMENT_RECORD_STATUS.APPROVED,
                createdAt: new Date(2026, 0, 1),
            },
            {
                providerTransactionId: 'inv-new',
                status: PAYMENT_RECORD_STATUS.APPROVED,
                createdAt: new Date(2026, 0, 2),
            },
        ]);
        fetchMock
            .mockResolvedValueOnce(
                reply(200, paymentInfo({ paymentMethod: 'pan' }))
            )
            .mockResolvedValueOnce(reply(500, { errText: 'server error' }));

        expect(await run()).toMatchObject({
            recordsResolved: 1,
            recordsFailed: 1,
            profilesUpdated: 0,
            profilesDeferred: 1,
        });

        const profile = await mongoose.connection
            .db!.collection(BILLING_PROFILES_COLLECTION)
            .findOne({ userId });
        expect(profile!.cardPaymentMethod).toBeUndefined();
    });

    it('відмова у доступі зупиняє прогін помилкою', async () => {
        const userId = new mongoose.Types.ObjectId();
        await seed(userId, [
            {
                providerTransactionId: 'inv-1',
                status: PAYMENT_RECORD_STATUS.APPROVED,
            },
            {
                providerTransactionId: 'inv-2',
                status: PAYMENT_RECORD_STATUS.APPROVED,
            },
        ]);
        fetchMock.mockResolvedValue(reply(401, { errText: 'invalid token' }));

        await expect(run()).rejects.toThrow(/MONOBANK_TOKEN/);
        // Другий рахунок навіть не питали — далі була б та сама відмова.
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('списання збереженим токеном не стає джерелом способу оплати для профілю', async () => {
        const userId = new mongoose.Types.ObjectId();
        await seed(userId, [
            {
                providerTransactionId: 'inv-checkout',
                status: PAYMENT_RECORD_STATUS.APPROVED,
                cardPaymentMethod: 'apple',
                cardPaymentSystem: 'visa',
                cardBank: 'ПриватБанк',
                createdAt: new Date(2026, 0, 1),
            },
            {
                providerTransactionId: 'inv-cycle',
                status: PAYMENT_RECORD_STATUS.APPROVED,
                cardPaymentMethod: 'wallet',
                cardPaymentSystem: 'visa',
                cardBank: 'ПриватБанк',
                createdAt: new Date(2026, 0, 2),
            },
        ]);

        expect(await run()).toMatchObject({
            recordsResolved: 0,
            profilesUpdated: 1,
        });
        // Жодного запиту: обидва списання вже мають спосіб оплати.
        expect(fetchMock).not.toHaveBeenCalled();

        const profile = await mongoose.connection
            .db!.collection(BILLING_PROFILES_COLLECTION)
            .findOne({ userId });
        expect(profile!.cardPaymentMethod).toBe('apple');
    });

    it('idempotent — повторний прогін нічого не перепитує', async () => {
        const userId = new mongoose.Types.ObjectId();
        await seed(userId, [
            {
                providerTransactionId: 'inv-1',
                status: PAYMENT_RECORD_STATUS.APPROVED,
            },
        ]);
        fetchMock.mockResolvedValueOnce(reply(200, paymentInfo()));

        await run();
        fetchMock.mockClear();

        expect(await run()).toEqual({
            recordsResolved: 0,
            recordsNotFound: 0,
            recordsFailed: 0,
            profilesUpdated: 0,
            profilesDeferred: 0,
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
