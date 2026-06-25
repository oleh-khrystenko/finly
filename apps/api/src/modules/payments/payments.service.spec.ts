import { BadRequestException, ConflictException } from '@nestjs/common';
import {
    PAYMENT_RECORD_STATUS,
    RESPONSE_CODE,
    SUBSCRIPTION_STATUS,
} from '@finly/types';
import { PaymentsService } from './payments.service';
import { IPaymentProvider } from './interfaces/payment-provider.interface';

/**
 * Sprint 22 — money-машина self-managed білінгу на mock-ах. Ключові інваріанти:
 * claim-first (не списувати вдруге), dunning (грейс → зняття доступу), guard-и.
 * Повний e2e зі справжнім Mongo — окремий тестовий захід.
 */
describe('PaymentsService (monobank, mocked)', () => {
    const USER = '507f1f77bcf86cd799439011';
    const PLAN_AMOUNT = 4900;

    let provider: jest.Mocked<IPaymentProvider>;
    let userModel: {
        findById: jest.Mock;
        findByIdAndUpdate: jest.Mock;
        updateOne: jest.Mock;
        findOneAndUpdate: jest.Mock;
    };
    let paymentRecordModel: {
        create: jest.Mock;
        findOne: jest.Mock;
        updateOne: jest.Mock;
        find: jest.Mock;
    };
    let webhookEventModel: Record<string, jest.Mock>;
    let usersService: { stampBillingReconcileRequired: jest.Mock };
    let emailService: {
        sendSubscriptionPastDue: jest.Mock;
        sendSubscriptionEnded: jest.Mock;
    };
    let reconciliation: { reconcile: jest.Mock };
    let service: PaymentsService;
    let currentUser: { email: string; billing: Record<string, unknown> } | null;

    function findByIdResult() {
        return {
            lean: jest.fn().mockResolvedValue(currentUser),
            session: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue(currentUser),
            }),
        };
    }

    function activeBilling(over: Record<string, unknown> = {}) {
        return {
            provider: 'monobank',
            cardToken: 'card-token',
            walletId: 'wallet-1',
            cardMask: '**1234',
            planCode: 'brand',
            currency: 'UAH',
            subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
            currentPeriodEnd: new Date('2026-06-01T12:00:00.000Z'),
            nextChargeAt: new Date('2026-06-01T12:00:00.000Z'),
            cancelAtPeriodEnd: false,
            hasActiveSubscription: true,
            lastProviderEventAt: null,
            dunningAttempts: 0,
            nextRetryAt: null,
            oneOffLevel: null,
            oneOffAccessUntil: null,
            oneOffOrderReference: null,
            reconcileRequiredAt: null,
            ...over,
        };
    }

    beforeEach(() => {
        provider = {
            createSubscriptionCheckout: jest.fn(),
            createOneOffCheckout: jest.fn(),
            chargeByToken: jest.fn(),
            getInvoiceStatus: jest.fn(),
            parseWebhook: jest.fn(),
        };
        userModel = {
            findById: jest.fn(() => findByIdResult()),
            findByIdAndUpdate: jest.fn().mockResolvedValue(null),
            updateOne: jest.fn().mockResolvedValue({}),
            findOneAndUpdate: jest.fn().mockResolvedValue({}),
        };
        paymentRecordModel = {
            create: jest.fn().mockResolvedValue({}),
            findOne: jest.fn(),
            // modifiedCount=1 → settle-гейт «цей виклик здійснив перехід».
            updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
            find: jest.fn(),
        };
        webhookEventModel = {
            create: jest.fn(),
            findOne: jest.fn(),
            updateOne: jest.fn(),
            deleteOne: jest.fn(),
        };
        usersService = {
            stampBillingReconcileRequired: jest
                .fn()
                .mockResolvedValue(undefined),
        };
        emailService = {
            sendSubscriptionPastDue: jest.fn().mockResolvedValue(undefined),
            sendSubscriptionEnded: jest.fn().mockResolvedValue(undefined),
        };
        reconciliation = { reconcile: jest.fn().mockResolvedValue(undefined) };
        const locks = {
            withLock: jest.fn(
                (_k: string, _t: number, fn: () => Promise<unknown>) => fn()
            ),
        };
        // Транзакція виконує колбек одразу (без реального Mongo).
        const connection = {
            startSession: jest.fn().mockResolvedValue({
                withTransaction: (fn: () => Promise<unknown>) => fn(),
                endSession: jest.fn().mockResolvedValue(undefined),
            }),
        };

        service = new PaymentsService(
            provider,
            userModel as never,
            webhookEventModel as never,
            paymentRecordModel as never,
            connection as never,
            usersService as never,
            emailService as never,
            reconciliation as never,
            locks as never
        );
        currentUser = { email: 'u@test.dev', billing: activeBilling() };
    });

    function lastSet(mock: jest.Mock): Record<string, unknown> {
        const call = mock.mock.calls[mock.mock.calls.length - 1];
        const update = call[1] as { $set: Record<string, unknown> };
        return update.$set;
    }

    describe('chargeDueSubscription', () => {
        it('success → просуває період і скидає dunning', async () => {
            provider.chargeByToken.mockResolvedValue({
                invoiceId: 'inv-1',
                status: 'success',
                cardMask: '**4242',
                cardToken: null,
                failureReason: null,
                errCode: null,
            });

            await service.chargeDueSubscription(USER);

            expect(provider.chargeByToken).toHaveBeenCalledTimes(1);
            const set = lastSet(userModel.updateOne);
            expect(set['billing.subscriptionStatus']).toBe(
                SUBSCRIPTION_STATUS.ACTIVE
            );
            expect(set['billing.dunningAttempts']).toBe(0);
            // межа просунута від 1 червня на місяць (без дрейфу)
            expect(set['billing.currentPeriodEnd']).toEqual(
                new Date('2026-07-01T12:00:00.000Z')
            );
            expect(set['billing.nextChargeAt']).toEqual(
                new Date('2026-07-01T12:00:00.000Z')
            );
        });

        it('declined → PAST_DUE з повтором і листом (доступ збережено)', async () => {
            provider.chargeByToken.mockResolvedValue({
                invoiceId: 'inv-1',
                status: 'failure',
                cardMask: null,
                cardToken: null,
                failureReason: 'insufficient',
                errCode: null,
            });

            await service.chargeDueSubscription(USER);

            const set = lastSet(userModel.updateOne);
            expect(set['billing.subscriptionStatus']).toBe(
                SUBSCRIPTION_STATUS.PAST_DUE
            );
            expect(set['billing.hasActiveSubscription']).toBe(true);
            expect(set['billing.dunningAttempts']).toBe(1);
            expect(set['billing.nextRetryAt']).toBeInstanceOf(Date);
            expect(emailService.sendSubscriptionPastDue).toHaveBeenCalledTimes(
                1
            );
            expect(emailService.sendSubscriptionEnded).not.toHaveBeenCalled();
        });

        it('declined на останній спробі → UNPAID, доступ знято, реконсиляція + лист', async () => {
            currentUser = {
                email: 'u@test.dev',
                // MAX=4 (test-setup); 3 попередні невдачі, ця четверта вичерпує
                billing: activeBilling({
                    subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE,
                    dunningAttempts: 3,
                }),
            };
            provider.chargeByToken.mockResolvedValue({
                invoiceId: 'inv-1',
                status: 'failure',
                cardMask: null,
                cardToken: null,
                failureReason: 'insufficient',
                errCode: null,
            });

            await service.chargeDueSubscription(USER);

            const set = lastSet(userModel.updateOne);
            expect(set['billing.subscriptionStatus']).toBe(
                SUBSCRIPTION_STATUS.UNPAID
            );
            expect(set['billing.hasActiveSubscription']).toBe(false);
            expect(set['billing.cardToken']).toBeNull();
            expect(reconciliation.reconcile).toHaveBeenCalledWith(USER);
            expect(emailService.sendSubscriptionEnded).toHaveBeenCalledTimes(1);
        });

        it('claim-first: спроба вже зафіксована → НЕ списує вдруге, звіряє статус', async () => {
            paymentRecordModel.create.mockRejectedValue(
                Object.assign(new Error('dup'), { code: 11000 })
            );
            paymentRecordModel.findOne.mockReturnValue({
                lean: jest.fn().mockResolvedValue({
                    _id: 'rec-1',
                    orderReference: 'ref',
                    status: PAYMENT_RECORD_STATUS.PENDING,
                    providerTransactionId: 'inv-1',
                }),
            });
            provider.getInvoiceStatus.mockResolvedValue({
                providerEventId: 'inv-1:success',
                orderReference: 'ref',
                invoiceId: 'inv-1',
                occurredAt: new Date(),
                status: 'success',
                amount: PLAN_AMOUNT,
                currency: 'UAH',
                cardToken: null,
                cardMask: '**4242',
                failureReason: null,
                errCode: null,
                raw: {},
            });

            await service.chargeDueSubscription(USER);

            expect(provider.chargeByToken).not.toHaveBeenCalled();
            expect(provider.getInvoiceStatus).toHaveBeenCalledTimes(1);
            const set = lastSet(userModel.updateOne);
            expect(set['billing.subscriptionStatus']).toBe(
                SUBSCRIPTION_STATUS.ACTIVE
            );
        });

        it('пропускає скасовану/без токена підписку', async () => {
            currentUser = {
                email: 'u@test.dev',
                billing: activeBilling({ cancelAtPeriodEnd: true }),
            };
            await service.chargeDueSubscription(USER);
            expect(provider.chargeByToken).not.toHaveBeenCalled();
        });
    });

    describe('cancelSubscription', () => {
        it('кінець періоду: знімає планування і токен, доступ лишається', async () => {
            await service.cancelSubscription(USER);
            const set = lastSet(userModel.findByIdAndUpdate);
            expect(set['billing.cancelAtPeriodEnd']).toBe(true);
            expect(set['billing.nextChargeAt']).toBeNull();
            expect(set['billing.cardToken']).toBeNull();
        });

        it('без активної підписки → помилка', async () => {
            currentUser = {
                email: 'u@test.dev',
                billing: activeBilling({ hasActiveSubscription: false }),
            };
            await expect(service.cancelSubscription(USER)).rejects.toThrow(
                BadRequestException
            );
        });
    });

    describe('guards', () => {
        it('checkout підписки за живого слота → ALREADY_SUBSCRIBED', async () => {
            await expect(
                service.createCheckoutSession(USER, {
                    paymentType: 'subscription',
                    planCode: 'brand',
                })
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.ALREADY_SUBSCRIBED },
            });
            expect(provider.createSubscriptionCheckout).not.toHaveBeenCalled();
        });

        it('resume не у прострочці → SUBSCRIPTION_NOT_PAST_DUE', async () => {
            await expect(
                service.resumeSubscription(USER, {})
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.SUBSCRIPTION_NOT_PAST_DUE },
            });
        });

        it('resume у прострочці → створює checkout без скидання білінгу', async () => {
            currentUser = {
                email: 'u@test.dev',
                billing: activeBilling({
                    subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE,
                }),
            };
            provider.createSubscriptionCheckout.mockResolvedValue({
                checkoutUrl: 'https://pay.mbnk.biz/x',
                invoiceId: 'inv-9',
                orderReference: 'ref',
            });
            const res = await service.resumeSubscription(USER, {});
            expect(res.checkoutUrl).toContain('mbnk');
            expect(provider.createSubscriptionCheckout).toHaveBeenCalledTimes(
                1
            );
            // білінг не скидається в INCOMPLETE під час resume
            expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
        });
    });

    it('lock зайнятий → BILLING_OPERATION_IN_PROGRESS', async () => {
        const { RedisLockBusyError } =
            await import('../../common/services/redis-lock.service');
        const locks = {
            withLock: jest.fn().mockRejectedValue(new RedisLockBusyError('k')),
        };
        const s = new PaymentsService(
            provider,
            userModel as never,
            webhookEventModel as never,
            paymentRecordModel as never,
            {} as never,
            usersService as never,
            emailService as never,
            reconciliation as never,
            locks as never
        );
        await expect(s.cancelSubscription(USER)).rejects.toBeInstanceOf(
            ConflictException
        );
    });
});
