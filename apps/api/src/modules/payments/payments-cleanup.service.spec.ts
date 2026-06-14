import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { Model } from 'mongoose';
import { SUBSCRIPTION_STATUS } from '@finly/types';

import {
    createStandaloneMongo,
    type InMemoryMongo,
} from '../../test-utils/mongo';
import { DEFERRED_START_FIRST_CHARGE_GRACE_MS } from '../../common/billing/deferred-start';
import { ReconciliationService } from '../businesses/reconciliation.service';
import { User, UserDocument, UserSchema } from '../users/schemas/user.schema';
import { PAYMENT_PROVIDER } from './interfaces/payment-provider.interface';
import { PaymentsCleanupService } from './payments-cleanup.service';
import {
    FailedRecurringRemoval,
    FailedRecurringRemovalDocument,
    FailedRecurringRemovalSchema,
} from './schemas/failed-recurring-removal.schema';
import {
    ProcessedWebhookEvent,
    ProcessedWebhookEventDocument,
    ProcessedWebhookEventSchema,
} from './schemas/processed-webhook-event.schema';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sprint 19 — добовий cleanup-cron. Реальні моделі на in-memory Mongo
 * (без транзакцій — standalone достатньо), мокнуті провайдер і реконсиляція.
 * Критично покрити Mongo-фільтри (зокрема `$nor` deferred-вікна) реальними
 * запитами: JS-дзеркало `isAwaitingDeferredFirstCharge` тестується окремо,
 * а дрейф самого фільтра ловиться лише тут.
 */
describe('PaymentsCleanupService (in-memory Mongo)', () => {
    let mongo: InMemoryMongo;
    let moduleRef: TestingModule;
    let service: PaymentsCleanupService;
    let userModel: Model<UserDocument>;
    let failedRemovalModel: Model<FailedRecurringRemovalDocument>;
    let webhookEventModel: Model<ProcessedWebhookEventDocument>;
    const reconciliation = {
        reconcileUnderLock: jest.fn().mockResolvedValue(undefined),
    };
    const provider = {
        removeSubscription: jest.fn().mockResolvedValue(undefined),
    };

    beforeAll(async () => {
        mongo = await createStandaloneMongo();
        moduleRef = await Test.createTestingModule({
            imports: [
                MongooseModule.forRoot(mongo.uri),
                MongooseModule.forFeature([
                    { name: User.name, schema: UserSchema },
                    {
                        name: FailedRecurringRemoval.name,
                        schema: FailedRecurringRemovalSchema,
                    },
                    {
                        name: ProcessedWebhookEvent.name,
                        schema: ProcessedWebhookEventSchema,
                    },
                ]),
            ],
            providers: [
                PaymentsCleanupService,
                { provide: PAYMENT_PROVIDER, useValue: provider },
                { provide: ReconciliationService, useValue: reconciliation },
            ],
        }).compile();

        service = moduleRef.get(PaymentsCleanupService);
        userModel = moduleRef.get(getModelToken(User.name));
        failedRemovalModel = moduleRef.get(
            getModelToken(FailedRecurringRemoval.name)
        );
        webhookEventModel = moduleRef.get(
            getModelToken(ProcessedWebhookEvent.name)
        );
    }, 30_000);

    afterAll(async () => {
        await moduleRef.close();
        await mongo.stop();
    });

    afterEach(async () => {
        await userModel.deleteMany({});
        await failedRemovalModel.deleteMany({});
        await webhookEventModel.deleteMany({});
        jest.clearAllMocks();
        // clearAllMocks не скидає implementations — повертаємо дефолти.
        provider.removeSubscription.mockResolvedValue(undefined);
        reconciliation.reconcileUnderLock.mockResolvedValue(undefined);
    });

    async function createUser(
        billing: Partial<NonNullable<UserDocument['billing']>> | null
    ): Promise<UserDocument> {
        return userModel.create({
            email: `u${Math.random().toString(36).slice(2)}@test.dev`,
            profile: {},
            executions: { balance: 0, freeReportUsed: false },
            billing:
                billing === null
                    ? null
                    : {
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
                          reconcileRequiredAt: null,
                          ...billing,
                      },
        });
    }

    function reconciledIds(): string[] {
        return reconciliation.reconcileUnderLock.mock.calls.map(
            (c: [string]) => c[0]
        );
    }

    // ── expireOneOffAccess ───────────────────────────────────────────────

    it('сплилий one-off: поля чистяться, стемп reconcileRequiredAt, reconcile викликано', async () => {
        const user = await createUser({
            oneOffLevel: 'brand',
            oneOffAccessUntil: new Date(Date.now() - DAY_MS),
            oneOffOrderReference: 'fin-oneoff-brand-x-y',
        });

        await service.runDailyCleanup();

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.oneOffLevel).toBeNull();
        expect(updated!.billing!.oneOffAccessUntil).toBeNull();
        expect(updated!.billing!.oneOffOrderReference).toBeNull();
        // Durable-стемп: reconcile, відкладений локом/крахом, добʼє daily-sweep
        // (мок реконсиляції стемп не знімає — він і має лишитись).
        expect(updated!.billing!.reconcileRequiredAt).toBeInstanceOf(Date);
        expect(reconciledIds()).toContain(user._id.toString());
    });

    it('активний one-off (дата у майбутньому) не зачіпається', async () => {
        const until = new Date(Date.now() + 10 * DAY_MS);
        const user = await createUser({
            oneOffLevel: 'bookkeeper',
            oneOffAccessUntil: until,
        });

        await service.runDailyCleanup();

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.oneOffLevel).toBe('bookkeeper');
        expect(updated!.billing!.oneOffAccessUntil!.getTime()).toBe(
            until.getTime()
        );
        expect(reconciliation.reconcileUnderLock).not.toHaveBeenCalled();
    });

    it('deferred-вікно ($nor): TRIALING зі свіжим currentPeriodEnd не експайриться', async () => {
        // One-off сплив, але підписка чекає першого deferred-списання —
        // прибирання one-off-полів тут запустило б руйнівний reconcile на none
        // для користувача, що вже оплатив продовження.
        const user = await createUser({
            planCode: 'brand',
            hasActiveSubscription: true,
            subscriptionStatus: SUBSCRIPTION_STATUS.TRIALING,
            currentPeriodEnd: new Date(Date.now() - 60 * 60 * 1000),
            oneOffLevel: 'brand',
            oneOffAccessUntil: new Date(Date.now() - 60 * 60 * 1000),
        });

        await service.runDailyCleanup();

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.oneOffLevel).toBe('brand');
        expect(updated!.billing!.oneOffAccessUntil).toBeInstanceOf(Date);
        expect(updated!.billing!.reconcileRequiredAt).toBeNull();
        expect(reconciliation.reconcileUnderLock).not.toHaveBeenCalled();
    });

    it('deferred-вікно закрите (grace минув): сплив обробляється як звичайний', async () => {
        const beyondGrace = new Date(
            Date.now() - DEFERRED_START_FIRST_CHARGE_GRACE_MS - DAY_MS
        );
        const user = await createUser({
            planCode: 'brand',
            hasActiveSubscription: true,
            subscriptionStatus: SUBSCRIPTION_STATUS.TRIALING,
            currentPeriodEnd: beyondGrace,
            oneOffLevel: 'brand',
            oneOffAccessUntil: beyondGrace,
        });

        await service.runDailyCleanup();

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.oneOffLevel).toBeNull();
        expect(reconciledIds()).toContain(user._id.toString());
    });

    // ── expire*Subscriptions / abandoned re-binds ────────────────────────

    it('canceled-at-period-end за межею: доступ знято, статус CANCELED, стемп', async () => {
        const user = await createUser({
            planCode: 'brand',
            hasActiveSubscription: true,
            subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
            cancelAtPeriodEnd: true,
            currentPeriodEnd: new Date(Date.now() - DAY_MS),
        });
        // Контроль: межа ще попереду — не чіпається.
        const active = await createUser({
            planCode: 'brand',
            hasActiveSubscription: true,
            subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
            cancelAtPeriodEnd: true,
            currentPeriodEnd: new Date(Date.now() + DAY_MS),
        });

        await service.runDailyCleanup();

        const expired = await userModel.findById(user._id).lean();
        expect(expired!.billing!.hasActiveSubscription).toBe(false);
        expect(expired!.billing!.subscriptionStatus).toBe(
            SUBSCRIPTION_STATUS.CANCELED
        );
        expect(expired!.billing!.reconcileRequiredAt).toBeInstanceOf(Date);
        expect(reconciledIds()).toContain(user._id.toString());

        const untouched = await userModel.findById(active._id).lean();
        expect(untouched!.billing!.hasActiveSubscription).toBe(true);
        expect(reconciledIds()).not.toContain(active._id.toString());
    });

    it('past-due за межею: UNPAID + rebindPendingAt чиститься', async () => {
        const user = await createUser({
            planCode: 'bookkeeper',
            hasActiveSubscription: true,
            subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE,
            currentPeriodEnd: new Date(Date.now() - DAY_MS),
            rebindPendingAt: new Date(),
        });

        await service.runDailyCleanup();

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.subscriptionStatus).toBe(
            SUBSCRIPTION_STATUS.UNPAID
        );
        expect(updated!.billing!.hasActiveSubscription).toBe(false);
        expect(updated!.billing!.rebindPendingAt).toBeNull();
        expect(reconciledIds()).toContain(user._id.toString());
    });

    it('кинутий re-bind за межею періоду: доступ знято', async () => {
        const user = await createUser({
            planCode: 'brand',
            hasActiveSubscription: true,
            subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
            currentPeriodEnd: new Date(Date.now() - DAY_MS),
            rebindPendingAt: new Date(Date.now() - 2 * DAY_MS),
        });

        await service.runDailyCleanup();

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.hasActiveSubscription).toBe(false);
        expect(updated!.billing!.subscriptionStatus).toBe(
            SUBSCRIPTION_STATUS.UNPAID
        );
        expect(updated!.billing!.rebindPendingAt).toBeNull();
    });

    // ── retryPendingReconciles ───────────────────────────────────────────

    it('durable-стемп без інших умов: reconcile добивається daily-sweep-ом', async () => {
        const stamped = await createUser({
            reconcileRequiredAt: new Date(Date.now() - DAY_MS),
        });
        const clean = await createUser({});

        await service.runDailyCleanup();

        expect(reconciledIds()).toContain(stamped._id.toString());
        expect(reconciledIds()).not.toContain(clean._id.toString());
    });

    // ── retryFailedRemovals ──────────────────────────────────────────────

    it('успішний REMOVE-ретрай видаляє запис черги; збій інкрементить attempts', async () => {
        await failedRemovalModel.create({
            provider: 'wayforpay',
            orderReference: 'fin-sub-ok',
            reason: 'cancel_refund',
            failedAt: new Date(),
            attempts: 0,
            lastAttemptAt: null,
        });
        await failedRemovalModel.create({
            provider: 'wayforpay',
            orderReference: 'fin-sub-fail',
            reason: 'cancel_refund',
            failedAt: new Date(),
            attempts: 1,
            lastAttemptAt: null,
        });
        provider.removeSubscription.mockImplementation(async (ref: string) => {
            if (ref === 'fin-sub-fail') throw new Error('WFP down');
        });

        await service.runDailyCleanup();

        expect(
            await failedRemovalModel.findOne({ orderReference: 'fin-sub-ok' })
        ).toBeNull();
        const failed = await failedRemovalModel
            .findOne({ orderReference: 'fin-sub-fail' })
            .lean();
        expect(failed!.attempts).toBe(2);
        expect(failed!.lastAttemptAt).toBeInstanceOf(Date);
    });

    it('запис із вичерпаними attempts більше не ретраїться', async () => {
        await failedRemovalModel.create({
            provider: 'wayforpay',
            orderReference: 'fin-sub-gaveup',
            reason: 'cancel_refund',
            failedAt: new Date(),
            attempts: 5,
            lastAttemptAt: new Date(),
        });

        await service.runDailyCleanup();

        expect(provider.removeSubscription).not.toHaveBeenCalled();
    });

    // ── sweepStalePendingEvents ──────────────────────────────────────────

    it('sweep прибирає лише старі pending-події (applied і свіжі pending лишаються)', async () => {
        const old = new Date(Date.now() - 20 * 60 * 1000); // > 15 хв порогу
        await webhookEventModel.create({
            provider: 'wayforpay',
            providerEventId: 'stale-pending',
            receivedAt: old,
            occurredAt: old,
            type: 'Approved',
            userId: null,
            oneOffCode: null,
            status: 'pending',
        });
        await webhookEventModel.create({
            provider: 'wayforpay',
            providerEventId: 'fresh-pending',
            receivedAt: new Date(),
            occurredAt: new Date(),
            type: 'Approved',
            userId: null,
            oneOffCode: null,
            status: 'pending',
        });
        await webhookEventModel.create({
            provider: 'wayforpay',
            providerEventId: 'old-applied',
            receivedAt: old,
            occurredAt: old,
            type: 'Approved',
            userId: null,
            oneOffCode: null,
            status: 'applied',
        });

        await service.runStalePendingSweep();

        const left = await webhookEventModel.find({}).lean();
        expect(left.map((e) => e.providerEventId).sort()).toEqual([
            'fresh-pending',
            'old-applied',
        ]);
    });

    // ── Step isolation ───────────────────────────────────────────────────

    it('збій раннього кроку не зриває решту ланцюга (сплив one-off виконується)', async () => {
        const retrySpy = jest
            .spyOn(
                service as unknown as {
                    retryFailedRemovals: () => Promise<void>;
                },
                'retryFailedRemovals'
            )
            .mockRejectedValue(new Error('transient Mongo failure'));
        const user = await createUser({
            oneOffLevel: 'brand',
            oneOffAccessUntil: new Date(Date.now() - DAY_MS),
        });

        await expect(service.runDailyCleanup()).resolves.toBeUndefined();

        const updated = await userModel.findById(user._id).lean();
        expect(updated!.billing!.oneOffLevel).toBeNull();
        expect(reconciledIds()).toContain(user._id.toString());
        retrySpy.mockRestore();
    });
});
