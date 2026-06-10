import {
    MongooseModule,
    getConnectionToken,
    getModelToken,
} from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { Connection, Model, Types } from 'mongoose';
import {
    PAYMENT_RECORD_STATUS,
    PAYMENT_RECORD_TYPE,
    PAYMENT_TYPE,
    RESPONSE_CODE,
    SUBSCRIPTION_STATUS,
    WAYFORPAY_TRANSACTION_STATUS,
    findOneOffAccess,
    findSubscriptionPlan,
    type BillingWebhookEvent,
} from '@finly/types';

import { createReplSetMongo, type InMemoryMongo } from '../../test-utils/mongo';
import { PaymentsService } from './payments.service';
import { ReconciliationService } from '../businesses/reconciliation.service';
import { PAYMENT_PROVIDER } from './interfaces/payment-provider.interface';
import { REDIS_CLIENT } from '../../common/modules/redis.module';
import { RedisLockService } from '../../common/services/redis-lock.service';
import { UsersService } from '../users/users.service';
import { User, UserDocument, UserSchema } from '../users/schemas/user.schema';
import {
    ExecutionTransaction,
    ExecutionTransactionSchema,
} from '../users/schemas/execution-transaction.schema';
import {
    ProcessedWebhookEvent,
    ProcessedWebhookEventSchema,
} from './schemas/processed-webhook-event.schema';
import {
    FailedRecurringRemoval,
    FailedRecurringRemovalDocument,
    FailedRecurringRemovalSchema,
} from './schemas/failed-recurring-removal.schema';
import {
    PaymentRecord,
    PaymentRecordDocument,
    PaymentRecordSchema,
} from './schemas/payment-record.schema';
import {
    buildOneOffOrderReference,
    buildSubscriptionOrderReference,
} from './order-reference';

type ProviderMock = {
    createSubscriptionCheckout: jest.Mock;
    createOneOffCheckout: jest.Mock;
    chargeByToken: jest.Mock;
    refund: jest.Mock;
    getSubscriptionStatus: jest.Mock;
    suspendSubscription: jest.Mock;
    resumeSubscription: jest.Mock;
    removeSubscription: jest.Mock;
    changeSubscription: jest.Mock;
    parseWebhook: jest.Mock;
};

function makeProviderMock(): ProviderMock {
    return {
        createSubscriptionCheckout: jest.fn(),
        createOneOffCheckout: jest.fn(),
        chargeByToken: jest.fn(),
        refund: jest.fn(),
        getSubscriptionStatus: jest.fn(),
        suspendSubscription: jest.fn().mockResolvedValue(undefined),
        resumeSubscription: jest.fn().mockResolvedValue(undefined),
        removeSubscription: jest.fn().mockResolvedValue(undefined),
        changeSubscription: jest.fn().mockResolvedValue(undefined),
        parseWebhook: jest.fn(),
    };
}

describe('PaymentsService (MongoMemoryReplSet)', () => {
    let mongo: InMemoryMongo;
    let moduleRef: TestingModule;
    let service: PaymentsService;
    let userModel: Model<UserDocument>;
    let paymentRecordModel: Model<PaymentRecordDocument>;
    let failedRemovalModel: Model<FailedRecurringRemovalDocument>;
    let provider: ProviderMock;
    let connection: Connection;
    let redisMock: { set: jest.Mock; eval: jest.Mock };

    beforeAll(async () => {
        mongo = await createReplSetMongo();
        provider = makeProviderMock();
        redisMock = {
            set: jest.fn().mockResolvedValue('OK'),
            eval: jest.fn().mockResolvedValue(1),
        };

        moduleRef = await Test.createTestingModule({
            imports: [
                MongooseModule.forRoot(mongo.uri),
                MongooseModule.forFeature([
                    { name: User.name, schema: UserSchema },
                    {
                        name: ExecutionTransaction.name,
                        schema: ExecutionTransactionSchema,
                    },
                    {
                        name: ProcessedWebhookEvent.name,
                        schema: ProcessedWebhookEventSchema,
                    },
                    {
                        name: FailedRecurringRemoval.name,
                        schema: FailedRecurringRemovalSchema,
                    },
                    { name: PaymentRecord.name, schema: PaymentRecordSchema },
                ]),
            ],
            providers: [
                PaymentsService,
                UsersService,
                {
                    provide: ReconciliationService,
                    useValue: {
                        reconcile: jest.fn().mockResolvedValue(undefined),
                    },
                },
                { provide: PAYMENT_PROVIDER, useValue: provider },
                {
                    // Per-user білінг-лок: за замовчуванням вільний (set → 'OK',
                    // release → 1). Окремий тест нижче форсує set → null, щоб
                    // перевірити відмову при зайнятому локу. Лок іде через
                    // справжній RedisLockService поверх цього ж мока.
                    provide: REDIS_CLIENT,
                    useValue: redisMock,
                },
                RedisLockService,
            ],
        }).compile();

        service = moduleRef.get(PaymentsService);
        userModel = moduleRef.get(getModelToken(User.name));
        paymentRecordModel = moduleRef.get(getModelToken(PaymentRecord.name));
        failedRemovalModel = moduleRef.get(
            getModelToken(FailedRecurringRemoval.name)
        );
        connection = moduleRef.get<Connection>(getConnectionToken());
        // Збудувати unique-індекси (зокрема ProcessedWebhookEvent) — без них
        // dedup на дублі webhook-події не спрацює.
        await connection.syncIndexes();
    }, 30_000);

    afterAll(async () => {
        await moduleRef.close();
        await mongo.stop();
    });

    afterEach(async () => {
        // Чистимо документи, але зберігаємо індекси (dropDatabase знищив би
        // unique-індекси, від яких залежить idempotency-тест).
        const collections = connection.collections;
        for (const key of Object.keys(collections)) {
            await collections[key].deleteMany({});
        }
        jest.clearAllMocks();
        // clearAllMocks не скидає implementations — повертаємо void-операції до
        // resolved-дефолту, інакше mockRejectedValue з одного тесту протікає далі.
        provider.suspendSubscription.mockResolvedValue(undefined);
        provider.resumeSubscription.mockResolvedValue(undefined);
        provider.removeSubscription.mockResolvedValue(undefined);
        provider.changeSubscription.mockResolvedValue(undefined);
    });

    async function createUser(
        billing?: Partial<NonNullable<UserDocument['billing']>>
    ): Promise<UserDocument> {
        return userModel.create({
            email: `u${Math.random().toString(36).slice(2)}@test.dev`,
            profile: {},
            executions: { balance: 0, freeReportUsed: false },
            billing: billing
                ? {
                      provider: 'wayforpay',
                      orderReference: null,
                      recToken: null,
                      cardMask: null,
                      planCode: null,
                      currency: 'UAH',
                      subscriptionStatus: null,
                      providerSubscriptionStatus: null,
                      currentPeriodEnd: null,
                      cancelAtPeriodEnd: false,
                      hasActiveSubscription: false,
                      lastProviderEventAt: null,
                      scheduledPlanCode: null,
                      scheduledChangeDate: null,
                      rebindPendingAt: null,
                      oneOffLevel: null,
                      oneOffAccessUntil: null,
                      oneOffOrderReference: null,
                      ...billing,
                  }
                : null,
        });
    }

    function approvedEvent(
        orderReference: string,
        overrides: Partial<BillingWebhookEvent> = {}
    ): BillingWebhookEvent {
        return {
            providerEventId: `${orderReference}:Approved:${Math.random()}`,
            orderReference,
            occurredAt: new Date(),
            transactionStatus: WAYFORPAY_TRANSACTION_STATUS.APPROVED,
            amount: 9900,
            currency: 'UAH',
            transactionId: 'tx_1',
            cardMask: '44****1111',
            recToken: null,
            reasonCode: 1100,
            raw: {},
            ...overrides,
        };
    }

    function feed(event: BillingWebhookEvent): Promise<unknown> {
        provider.parseWebhook.mockResolvedValueOnce({
            event,
            acceptResponse: { status: 'accept' },
        });
        return service.handleWebhook(Buffer.from('{}'));
    }

    // ── One-off access ────────────────────────────────────────────────────

    it('one-off Approved дає тимчасовий доступ до рівня і пише PaymentRecord', async () => {
        const user = await createUser();
        const ref = buildOneOffOrderReference(
            user._id.toString(),
            'bookkeeper'
        );
        const access = findOneOffAccess('bookkeeper')!;

        await feed(approvedEvent(ref, { amount: access.priceAmount }));

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.oneOffLevel).toBe('bookkeeper');
        expect(updated!.billing!.oneOffAccessUntil).toBeInstanceOf(Date);
        // Слот привʼязаний до покупки — refund гасить доступ лише при збігу.
        expect(updated!.billing!.oneOffOrderReference).toBe(ref);
        expect(updated!.billing!.hasActiveSubscription).toBe(false);
        // Ledger білінг більше не наповнює.
        expect(updated!.executions.balance).toBe(0);

        const records = await paymentRecordModel.find({ userId: user._id });
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            type: PAYMENT_RECORD_TYPE.ONE_OFF,
            status: PAYMENT_RECORD_STATUS.APPROVED,
        });
    });

    it('one-off REFUNDED знімає орендований доступ + тригерить reconcile', async () => {
        const user = await createUser({
            oneOffLevel: 'brand',
            oneOffAccessUntil: new Date(Date.now() + 20 * 86_400_000),
        });
        const ref = buildOneOffOrderReference(user._id.toString(), 'brand');
        // Слот тримає саме ця покупка — guard у refund-гілці має збіг.
        await userModel.findByIdAndUpdate(user._id, {
            $set: { 'billing.oneOffOrderReference': ref },
        });

        await feed(
            approvedEvent(ref, {
                transactionStatus: WAYFORPAY_TRANSACTION_STATUS.REFUNDED,
                amount: findOneOffAccess('brand')!.priceAmount,
            })
        );

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.oneOffLevel).toBeNull();
        expect(updated!.billing!.oneOffAccessUntil).toBeNull();
        expect(updated!.billing!.oneOffOrderReference).toBeNull();
        const reconcile = moduleRef.get<{ reconcile: jest.Mock }>(
            ReconciliationService
        ).reconcile;
        expect(reconcile).toHaveBeenCalledWith(user._id.toString());
    });

    it('REFUNDED старішої покупки (слот перезаписано новішою) НЕ гасить чинний доступ', async () => {
        // createUser({}) → білінг-субдок існує (dotted $set нижче потребує
        // non-null billing).
        const user = await createUser({});
        const userId = user._id.toString();
        const oldRef = buildOneOffOrderReference(userId, 'brand');
        const newRef = buildOneOffOrderReference(userId, 'bookkeeper');

        // Слот тримає новіша bookkeeper-покупка (overwrite-модель).
        await userModel.findByIdAndUpdate(user._id, {
            $set: {
                'billing.oneOffLevel': 'bookkeeper',
                'billing.oneOffAccessUntil': new Date(
                    Date.now() + 25 * 86_400_000
                ),
                'billing.oneOffOrderReference': newRef,
            },
        });

        // Support повертає гроші за стару brand-покупку.
        await feed(
            approvedEvent(oldRef, {
                transactionStatus: WAYFORPAY_TRANSACTION_STATUS.REFUNDED,
                amount: findOneOffAccess('brand')!.priceAmount,
            })
        );

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.oneOffLevel).toBe('bookkeeper');
        expect(updated!.billing!.oneOffAccessUntil).toBeInstanceOf(Date);
        expect(updated!.billing!.oneOffOrderReference).toBe(newRef);
    });

    it('ідемпотентність: дубль one-off події дає доступ лише раз', async () => {
        const user = await createUser();
        const ref = buildOneOffOrderReference(user._id.toString(), 'brand');
        const access = findOneOffAccess('brand')!;
        const event = approvedEvent(ref, { amount: access.priceAmount });

        await feed(event);
        await feed(event); // той самий providerEventId

        const records = await paymentRecordModel.find({ userId: user._id });
        expect(records).toHaveLength(1);
        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.oneOffLevel).toBe('brand');
    });

    // ── Subscription activation + out-of-order ───────────────────────────

    it('INCOMPLETE → ACTIVE на першому Approved (негайний старт, без trial)', async () => {
        const ref = buildSubscriptionOrderReference('placeholder');
        const user = await createUser({
            orderReference: ref,
            planCode: 'bookkeeper',
            subscriptionStatus: SUBSCRIPTION_STATUS.INCOMPLETE,
            currentPeriodEnd: null, // негайний старт (немає відкладеної дати)
        });
        const realRef = buildSubscriptionOrderReference(user._id.toString());
        await userModel.findByIdAndUpdate(user._id, {
            $set: { 'billing.orderReference': realRef },
        });

        const plan = findSubscriptionPlan('bookkeeper')!;
        await feed(
            approvedEvent(realRef, {
                amount: plan.priceAmount,
                recToken: 'tok_live',
            })
        );

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.subscriptionStatus).toBe(
            SUBSCRIPTION_STATUS.ACTIVE
        );
        expect(updated!.billing!.hasActiveSubscription).toBe(true);
        expect(updated!.billing!.recToken).toBe('tok_live');
        expect(updated!.billing!.currentPeriodEnd).toBeInstanceOf(Date);
        // Ledger білінг більше не наповнює.
        expect(updated!.executions.balance).toBe(0);
    });

    it('INCOMPLETE → TRIALING на відкладеному старті поверх one-off', async () => {
        const deferredUntil = new Date(Date.now() + 20 * 86_400_000);
        const user = await createUser({
            orderReference: 'placeholder',
            planCode: 'bookkeeper',
            subscriptionStatus: SUBSCRIPTION_STATUS.INCOMPLETE,
            // currentPeriodEnd у майбутньому = сигнал відкладеного першого
            // списання (one-off ще активний).
            currentPeriodEnd: deferredUntil,
        });
        const realRef = buildSubscriptionOrderReference(user._id.toString());
        await userModel.findByIdAndUpdate(user._id, {
            $set: { 'billing.orderReference': realRef },
        });

        await feed(approvedEvent(realRef, { recToken: 'tok_live' }));

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.subscriptionStatus).toBe(
            SUBSCRIPTION_STATUS.TRIALING
        );
        expect(updated!.billing!.hasActiveSubscription).toBe(true);
        // Період лишається датою відкладеного старту, не occurredAt + інтервал.
        expect(updated!.billing!.currentPeriodEnd!.getTime()).toBe(
            deferredUntil.getTime()
        );
    });

    it('out-of-order: застаріла подія (раніший occurredAt) ігнорується', async () => {
        const user = await createUser({
            subscriptionStatus: SUBSCRIPTION_STATUS.INCOMPLETE,
            currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
            planCode: 'brand',
        });
        const ref = buildSubscriptionOrderReference(user._id.toString());
        await userModel.findByIdAndUpdate(user._id, {
            $set: { 'billing.orderReference': ref },
        });

        const newer = new Date();
        const older = new Date(newer.getTime() - 60_000);

        // Новіша Approved встановлює lastProviderEventAt = newer.
        await feed(approvedEvent(ref, { occurredAt: newer, amount: 4900 }));
        // Старіша Declined НЕ повинна перевести у PAST_DUE.
        await feed(
            approvedEvent(ref, {
                occurredAt: older,
                transactionStatus: WAYFORPAY_TRANSACTION_STATUS.DECLINED,
            })
        );

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.subscriptionStatus).not.toBe(
            SUBSCRIPTION_STATUS.PAST_DUE
        );
    });

    // ── Change plan (upgrade proration) ──────────────────────────────────

    it('upgrade: тиха доплата за токеном і зміна плану', async () => {
        const user = await createUser({
            orderReference: 'placeholder',
            planCode: 'brand',
            recToken: 'tok_abc',
            subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
            hasActiveSubscription: true,
            currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000),
        });
        const ref = buildSubscriptionOrderReference(user._id.toString());
        await userModel.findByIdAndUpdate(user._id, {
            $set: { 'billing.orderReference': ref },
        });

        provider.chargeByToken.mockResolvedValue({
            success: true,
            transactionId: 'tx_bk',
            cardMask: '44****1111',
            reasonCode: 1100,
            reason: 'Ok',
        });

        const result = await service.changePlan(user._id.toString(), {
            planCode: 'bookkeeper',
        });

        expect(result.scheduled).toBe(false);
        expect(provider.chargeByToken).toHaveBeenCalled();
        expect(provider.changeSubscription).toHaveBeenCalled();

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.planCode).toBe('bookkeeper');

        const proration = await paymentRecordModel.findOne({
            userId: user._id,
            type: PAYMENT_RECORD_TYPE.PRORATION,
        });
        expect(proration).not.toBeNull();

        // Рівень зріс → reconcile знімає блокування у межах нового тарифу.
        const reconcile = moduleRef.get<{ reconcile: jest.Mock }>(
            ReconciliationService
        ).reconcile;
        expect(reconcile).toHaveBeenCalledWith(user._id.toString());
    });

    it('upgrade: невдала доплата — план не змінюється', async () => {
        const user = await createUser({
            orderReference: 'r',
            planCode: 'brand',
            recToken: 'tok_abc',
            subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
            hasActiveSubscription: true,
            currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000),
        });
        const ref = buildSubscriptionOrderReference(user._id.toString());
        await userModel.findByIdAndUpdate(user._id, {
            $set: { 'billing.orderReference': ref },
        });

        provider.chargeByToken.mockResolvedValue({
            success: false,
            transactionId: null,
            cardMask: null,
            reasonCode: 1101,
            reason: 'Declined',
        });

        await expect(
            service.changePlan(user._id.toString(), { planCode: 'bookkeeper' })
        ).rejects.toThrow();

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.planCode).toBe('brand');
        expect(provider.changeSubscription).not.toHaveBeenCalled();
    });

    it('upgrade: збій CHANGE рекуренту після доплати кидає, план не застосовано', async () => {
        const user = await createUser({
            orderReference: 'r',
            planCode: 'brand',
            recToken: 'tok_abc',
            subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
            hasActiveSubscription: true,
            currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000),
        });
        const ref = buildSubscriptionOrderReference(user._id.toString());
        await userModel.findByIdAndUpdate(user._id, {
            $set: { 'billing.orderReference': ref },
        });

        provider.chargeByToken.mockResolvedValue({
            success: true,
            transactionId: 'tx_bk',
            cardMask: '44****1111',
            reasonCode: 1100,
            reason: 'Ok',
        });
        provider.changeSubscription.mockRejectedValue(new Error('WFP down'));
        provider.refund.mockResolvedValue({
            success: true,
            reasonCode: 1100,
            reason: 'Ok',
        });

        await expect(
            service.changePlan(user._id.toString(), { planCode: 'bookkeeper' })
        ).rejects.toThrow();

        // Тихий дрейф білінгу неприпустимий: план НЕ застосовано локально.
        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.planCode).toBe('brand');

        // Доплату вже списали — мусимо повернути, інакше юзер заплатив за
        // апгрейд, якого не отримав.
        expect(provider.refund).toHaveBeenCalled();
        const proration = await paymentRecordModel
            .findOne({ type: PAYMENT_RECORD_TYPE.PRORATION })
            .lean();
        expect(proration!.status).toBe(PAYMENT_RECORD_STATUS.REFUNDED);
    });

    it('cancel withRefund: збій REMOVE ставить orderReference у retry-чергу', async () => {
        const user = await createUser({
            orderReference: 'r',
            planCode: 'bookkeeper',
            subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
            hasActiveSubscription: true,
            currentPeriodEnd: new Date(Date.now() + 15 * 86_400_000),
        });
        const ref = buildSubscriptionOrderReference(user._id.toString());
        await userModel.findByIdAndUpdate(user._id, {
            $set: { 'billing.orderReference': ref },
        });
        await paymentRecordModel.create({
            userId: user._id,
            orderReference: ref,
            type: PAYMENT_RECORD_TYPE.SUBSCRIPTION,
            amount: 9900,
            currency: 'UAH',
            status: PAYMENT_RECORD_STATUS.APPROVED,
            providerTransactionId: 'tx_1',
            cardMask: '44****1111',
            refundAmount: null,
        });

        provider.refund.mockResolvedValue({
            success: true,
            reasonCode: 1100,
            reason: 'Ok',
        });
        provider.removeSubscription.mockRejectedValue(new Error('WFP down'));

        await service.cancelSubscription(user._id.toString(), {
            withRefund: true,
        });

        // REMOVE впав, але скасування завершилось і REMOVE поставлено у чергу
        // повторів — інакше WayForPay списував би далі.
        const queued = await failedRemovalModel.findOne({
            orderReference: ref,
        });
        expect(queued).not.toBeNull();
        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.hasActiveSubscription).toBe(false);
    });

    it('downgrade: планується на наступний період', async () => {
        const user = await createUser({
            orderReference: 'r',
            planCode: 'bookkeeper',
            recToken: 'tok_abc',
            subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
            hasActiveSubscription: true,
            currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000),
        });
        const ref = buildSubscriptionOrderReference(user._id.toString());
        await userModel.findByIdAndUpdate(user._id, {
            $set: { 'billing.orderReference': ref },
        });

        const result = await service.changePlan(user._id.toString(), {
            planCode: 'brand',
        });

        expect(result.scheduled).toBe(true);
        expect(provider.chargeByToken).not.toHaveBeenCalled();
        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.scheduledPlanCode).toBe('brand');
        expect(updated!.billing!.planCode).toBe('bookkeeper');
    });

    // ── Cancel with refund ───────────────────────────────────────────────

    it('cancel withRefund: повертає кошти, REMOVE, білінг CANCELED', async () => {
        const user = await createUser({
            orderReference: 'r',
            planCode: 'bookkeeper',
            subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
            hasActiveSubscription: true,
            currentPeriodEnd: new Date(Date.now() + 15 * 86_400_000),
        });
        const ref = buildSubscriptionOrderReference(user._id.toString());
        await userModel.findByIdAndUpdate(user._id, {
            $set: { 'billing.orderReference': ref },
        });
        await paymentRecordModel.create({
            userId: user._id,
            orderReference: ref,
            type: PAYMENT_RECORD_TYPE.SUBSCRIPTION,
            amount: 9900,
            currency: 'UAH',
            status: PAYMENT_RECORD_STATUS.APPROVED,
            providerTransactionId: 'tx_1',
            cardMask: '44****1111',
            refundAmount: null,
        });

        provider.refund.mockResolvedValue({
            success: true,
            reasonCode: 1100,
            reason: 'Ok',
        });

        const result = await service.cancelSubscription(user._id.toString(), {
            withRefund: true,
        });

        expect(result.refundedAmount).toBeGreaterThan(0);
        expect(provider.refund).toHaveBeenCalled();
        expect(provider.removeSubscription).toHaveBeenCalledWith(ref);

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.subscriptionStatus).toBe(
            SUBSCRIPTION_STATUS.CANCELED
        );
        expect(updated!.billing!.hasActiveSubscription).toBe(false);

        const refunded = await paymentRecordModel.findOne({
            userId: user._id,
            status: PAYMENT_RECORD_STATUS.REFUNDED,
        });
        expect(refunded).not.toBeNull();
    });

    it('cancel withRefund: транспортний збій refund кидає, claim лишається REFUNDED, білінг не флипнуто', async () => {
        const user = await createUser({
            orderReference: 'r',
            planCode: 'bookkeeper',
            subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
            hasActiveSubscription: true,
            currentPeriodEnd: new Date(Date.now() + 15 * 86_400_000),
        });
        const ref = buildSubscriptionOrderReference(user._id.toString());
        await userModel.findByIdAndUpdate(user._id, {
            $set: { 'billing.orderReference': ref },
        });
        await paymentRecordModel.create({
            userId: user._id,
            orderReference: ref,
            type: PAYMENT_RECORD_TYPE.SUBSCRIPTION,
            amount: 9900,
            currency: 'UAH',
            status: PAYMENT_RECORD_STATUS.APPROVED,
            providerTransactionId: 'tx_1',
            cardMask: '44****1111',
            refundAmount: null,
        });

        // Транспортний збій (timeout/network) — результат refund-а невідомий,
        // на відміну від явного `success: false`.
        provider.refund.mockRejectedValueOnce(new Error('WFP timeout'));

        await expect(
            service.cancelSubscription(user._id.toString(), {
                withRefund: true,
            })
        ).rejects.toThrow();

        // Claim-first: мітка НЕ відкочується (гроші могли рухатись — повтор не
        // сміє списати refund удруге; ручний розбір за ERROR-логом).
        const record = await paymentRecordModel
            .findOne({ orderReference: ref })
            .lean();
        expect(record!.status).toBe(PAYMENT_RECORD_STATUS.REFUNDED);

        // Операція НЕ завершилась успіхом: REMOVE не викликано, доступ живий.
        expect(provider.removeSubscription).not.toHaveBeenCalled();
        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.hasActiveSubscription).toBe(true);
    });

    // ── Checkout після попередньої підписки ──────────────────────────────

    it('новий subscription-checkout зносить старий рекурент (UNPAID з recToken), без recToken не чіпає', async () => {
        // UNPAID після past-due sweep: рекурент свідомо лишився живим у
        // WayForPay. Новий checkout перезаписує orderReference — без REMOVE
        // пізніше списання старого рекуренту прийшло б зі stale-reference і
        // було б проігнороване (гроші списані, доступ не зарахований).
        const lapsed = await createUser({
            planCode: 'brand',
            recToken: 'tok_old',
            subscriptionStatus: SUBSCRIPTION_STATUS.UNPAID,
            hasActiveSubscription: false,
        });
        const oldRef = buildSubscriptionOrderReference(lapsed._id.toString());
        await userModel.findByIdAndUpdate(lapsed._id, {
            $set: { 'billing.orderReference': oldRef },
        });
        provider.createSubscriptionCheckout.mockResolvedValue({
            checkoutUrl: 'https://pay.example/checkout',
            orderReference: 'irrelevant',
        });

        await service.createCheckoutSession(lapsed._id.toString(), {
            paymentType: PAYMENT_TYPE.SUBSCRIPTION,
            planCode: 'brand',
        });
        expect(provider.removeSubscription).toHaveBeenCalledWith(oldRef);
        expect(provider.removeSubscription).toHaveBeenCalledTimes(1);

        // Кинутий INCOMPLETE-checkout (без recToken — привʼязки не було):
        // рекурент не існує, REMOVE не викликається (не засмічуємо retry-чергу).
        const abandoned = await createUser({
            planCode: 'brand',
            recToken: null,
            subscriptionStatus: SUBSCRIPTION_STATUS.INCOMPLETE,
            hasActiveSubscription: false,
        });
        const abandonedRef = buildSubscriptionOrderReference(
            abandoned._id.toString()
        );
        await userModel.findByIdAndUpdate(abandoned._id, {
            $set: { 'billing.orderReference': abandonedRef },
        });

        await service.createCheckoutSession(abandoned._id.toString(), {
            paymentType: PAYMENT_TYPE.SUBSCRIPTION,
            planCode: 'brand',
        });
        expect(provider.removeSubscription).toHaveBeenCalledTimes(1);
    });

    // ── Refund webhook (markRefunded) ────────────────────────────────────

    it('refund-webhook не псує стороннє APPROVED-списання (партіальний refund)', async () => {
        const user = await createUser();
        const ref = buildSubscriptionOrderReference(user._id.toString());

        // Старе валідне списання, що НЕ повертається.
        await paymentRecordModel.create({
            userId: user._id,
            orderReference: ref,
            type: PAYMENT_RECORD_TYPE.SUBSCRIPTION,
            amount: 14900,
            currency: 'UAH',
            status: PAYMENT_RECORD_STATUS.APPROVED,
            providerTransactionId: 'tx_old',
            cardMask: '44****1111',
            refundAmount: null,
        });
        // Поточне списання, вже відмічене REFUNDED синхронно (як у cancel-with-
        // refund) на партіальну суму.
        await paymentRecordModel.create({
            userId: user._id,
            orderReference: ref,
            type: PAYMENT_RECORD_TYPE.SUBSCRIPTION,
            amount: 14900,
            currency: 'UAH',
            status: PAYMENT_RECORD_STATUS.REFUNDED,
            providerTransactionId: 'tx_new',
            cardMask: '44****1111',
            refundAmount: 7000,
        });

        // Редундантний refund-вебхук: партіальна сума + txn, що не збігається з
        // жодним записом. Старий fallback зіпсував би tx_old.
        await feed(
            approvedEvent(ref, {
                transactionStatus: WAYFORPAY_TRANSACTION_STATUS.REFUNDED,
                amount: 7000,
                transactionId: 'tx_refund',
            })
        );

        const stillApproved = await paymentRecordModel.findOne({
            providerTransactionId: 'tx_old',
        });
        expect(stillApproved!.status).toBe(PAYMENT_RECORD_STATUS.APPROVED);
    });

    it('refund-webhook мітить саме списання за transactionId', async () => {
        const user = await createUser();
        const ref = buildSubscriptionOrderReference(user._id.toString());
        await paymentRecordModel.create({
            userId: user._id,
            orderReference: ref,
            type: PAYMENT_RECORD_TYPE.SUBSCRIPTION,
            amount: 14900,
            currency: 'UAH',
            status: PAYMENT_RECORD_STATUS.APPROVED,
            providerTransactionId: 'tx_match',
            cardMask: '44****1111',
            refundAmount: null,
        });

        await feed(
            approvedEvent(ref, {
                transactionStatus: WAYFORPAY_TRANSACTION_STATUS.REFUNDED,
                amount: 14900,
                transactionId: 'tx_match',
            })
        );

        const record = await paymentRecordModel.findOne({
            providerTransactionId: 'tx_match',
        });
        expect(record!.status).toBe(PAYMENT_RECORD_STATUS.REFUNDED);
        expect(record!.refundAmount).toBe(14900);
    });

    it('вебхук відкладається (без accept), якщо per-user лок зайнятий', async () => {
        const user = await createUser();
        const ref = buildOneOffOrderReference(user._id.toString(), 'brand');
        const access = findOneOffAccess('brand')!;
        redisMock.set.mockResolvedValueOnce(null); // лок зайнятий user-мутацією

        const accept = await feed(
            approvedEvent(ref, { amount: access.priceAmount })
        );

        // Немає accept → WayForPay передоставить подію пізніше.
        expect(accept).toBeNull();
        // Подія не оброблена: доступ не надано.
        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing).toBeNull();
    });

    it('cancel у кінці періоду: cancelAtPeriodEnd=true, доступ лишається', async () => {
        const user = await createUser({
            orderReference: 'r',
            planCode: 'pro',
            subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
            hasActiveSubscription: true,
            currentPeriodEnd: new Date(Date.now() + 15 * 86_400_000),
        });
        const ref = buildSubscriptionOrderReference(user._id.toString());
        await userModel.findByIdAndUpdate(user._id, {
            $set: { 'billing.orderReference': ref },
        });

        const result = await service.cancelSubscription(user._id.toString(), {
            withRefund: false,
        });

        expect(result.refundedAmount).toBeNull();
        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.cancelAtPeriodEnd).toBe(true);
        expect(updated!.billing!.hasActiveSubscription).toBe(true);
    });

    it('зайнятий per-user лок відхиляє конкурентну білінг-мутацію', async () => {
        redisMock.set.mockResolvedValueOnce(null);

        const error = await service
            .changePlan(new Types.ObjectId().toString(), {
                planCode: 'bookkeeper',
            })
            .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({
            code: RESPONSE_CODE.BILLING_OPERATION_IN_PROGRESS,
        });
        // Lock не захоплено → release не викликається.
        expect(redisMock.eval).not.toHaveBeenCalled();
    });

    it('checkout-session серіалізується тим самим локом', async () => {
        redisMock.set.mockResolvedValueOnce(null);

        const error = await service
            .createCheckoutSession(new Types.ObjectId().toString(), {
                paymentType: PAYMENT_TYPE.SUBSCRIPTION,
                planCode: 'brand',
            })
            .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({
            code: RESPONSE_CODE.BILLING_OPERATION_IN_PROGRESS,
        });
    });
});
