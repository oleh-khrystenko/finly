import {
    MongooseModule,
    getConnectionToken,
    getModelToken,
} from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import {
    PAYMENT_RECORD_STATUS,
    PAYMENT_RECORD_TYPE,
    SUBSCRIPTION_STATUS,
    WAYFORPAY_TRANSACTION_STATUS,
    findExecutionPack,
    findSubscriptionPlan,
    type BillingWebhookEvent,
} from '@finly/types';

import { createStandaloneMongo, type InMemoryMongo } from '../../test-utils/mongo';
import { PaymentsService } from './payments.service';
import { PAYMENT_PROVIDER } from './interfaces/payment-provider.interface';
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
    buildPackOrderReference,
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

describe('PaymentsService (MongoMemoryServer)', () => {
    let mongo: InMemoryMongo;
    let moduleRef: TestingModule;
    let service: PaymentsService;
    let userModel: Model<UserDocument>;
    let paymentRecordModel: Model<PaymentRecordDocument>;
    let failedRemovalModel: Model<FailedRecurringRemovalDocument>;
    let provider: ProviderMock;
    let connection: Connection;

    beforeAll(async () => {
        mongo = await createStandaloneMongo();
        provider = makeProviderMock();

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
                { provide: PAYMENT_PROVIDER, useValue: provider },
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

    // ── Pack purchase ────────────────────────────────────────────────────

    it('pack-webhook Approved нараховує executions і пише PaymentRecord', async () => {
        const user = await createUser();
        const ref = buildPackOrderReference(user._id.toString(), 'max');
        const pack = findExecutionPack('max')!;

        await feed(
            approvedEvent(ref, { amount: pack.priceAmount })
        );

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.executions.balance).toBe(pack.executions);

        const records = await paymentRecordModel.find({ userId: user._id });
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            type: PAYMENT_RECORD_TYPE.PACK,
            status: PAYMENT_RECORD_STATUS.APPROVED,
        });
    });

    it('ідемпотентність: дубль події нараховує executions лише раз', async () => {
        const user = await createUser();
        const ref = buildPackOrderReference(user._id.toString(), 'basic');
        const pack = findExecutionPack('basic')!;
        const event = approvedEvent(ref, { amount: pack.priceAmount });

        await feed(event);
        await feed(event); // той самий providerEventId

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.executions.balance).toBe(pack.executions);
    });

    // ── Subscription activation + out-of-order ───────────────────────────

    it('INCOMPLETE → TRIALING на першому Approved, нараховує план-executions', async () => {
        const ref = buildSubscriptionOrderReference('placeholder');
        const user = await createUser({
            orderReference: ref,
            planCode: 'pro',
            subscriptionStatus: SUBSCRIPTION_STATUS.INCOMPLETE,
            currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
        });
        const realRef = buildSubscriptionOrderReference(user._id.toString());
        await userModel.findByIdAndUpdate(user._id, {
            $set: { 'billing.orderReference': realRef },
        });

        const plan = findSubscriptionPlan('pro')!;
        await feed(
            approvedEvent(realRef, {
                amount: plan.priceAmount,
                recToken: 'tok_live',
            })
        );

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.subscriptionStatus).toBe(
            SUBSCRIPTION_STATUS.TRIALING
        );
        expect(updated!.billing!.hasActiveSubscription).toBe(true);
        expect(updated!.billing!.recToken).toBe('tok_live');
        expect(updated!.executions.balance).toBe(plan.executions);
    });

    it('out-of-order: застаріла подія (раніший occurredAt) ігнорується', async () => {
        const user = await createUser({
            subscriptionStatus: SUBSCRIPTION_STATUS.INCOMPLETE,
            currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
            planCode: 'starter',
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

    it('upgrade: тиха доплата за токеном, зміна плану і нарахування executions', async () => {
        const user = await createUser({
            orderReference: 'placeholder',
            planCode: 'starter',
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
            transactionId: 'tx_pro',
            cardMask: '44****1111',
            reasonCode: 1100,
            reason: 'Ok',
        });

        const result = await service.changePlan(user._id.toString(), {
            planCode: 'pro',
        });

        expect(result.scheduled).toBe(false);
        expect(provider.chargeByToken).toHaveBeenCalled();
        expect(provider.changeSubscription).toHaveBeenCalled();

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.planCode).toBe('pro');
        expect(updated!.executions.balance).toBeGreaterThan(0);

        const proration = await paymentRecordModel.findOne({
            userId: user._id,
            type: PAYMENT_RECORD_TYPE.PRORATION,
        });
        expect(proration).not.toBeNull();
    });

    it('upgrade: невдала доплата — план не змінюється', async () => {
        const user = await createUser({
            orderReference: 'r',
            planCode: 'starter',
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
            service.changePlan(user._id.toString(), { planCode: 'pro' })
        ).rejects.toThrow();

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.planCode).toBe('starter');
        expect(provider.changeSubscription).not.toHaveBeenCalled();
    });

    it('upgrade: збій CHANGE рекуренту після доплати кидає, план не застосовано', async () => {
        const user = await createUser({
            orderReference: 'r',
            planCode: 'starter',
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
            transactionId: 'tx_pro',
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
            service.changePlan(user._id.toString(), { planCode: 'pro' })
        ).rejects.toThrow();

        // Тихий дрейф білінгу неприпустимий: план НЕ застосовано локально.
        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.planCode).toBe('starter');

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
            planCode: 'pro',
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
            amount: 14900,
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
        const queued = await failedRemovalModel.findOne({ orderReference: ref });
        expect(queued).not.toBeNull();
        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.hasActiveSubscription).toBe(false);
    });

    it('downgrade: планується на наступний період', async () => {
        const user = await createUser({
            orderReference: 'r',
            planCode: 'pro',
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
            planCode: 'starter',
        });

        expect(result.scheduled).toBe(true);
        expect(provider.chargeByToken).not.toHaveBeenCalled();
        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.scheduledPlanCode).toBe('starter');
        expect(updated!.billing!.planCode).toBe('pro');
    });

    // ── Cancel with refund ───────────────────────────────────────────────

    it('cancel withRefund: повертає кошти, REMOVE, білінг CANCELED', async () => {
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
        await paymentRecordModel.create({
            userId: user._id,
            orderReference: ref,
            type: PAYMENT_RECORD_TYPE.SUBSCRIPTION,
            amount: 14900,
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
});
