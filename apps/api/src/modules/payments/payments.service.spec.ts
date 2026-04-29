import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
    BILLING_EVENT_TYPE,
    PAYMENT_TYPE,
    RESPONSE_CODE,
    SUBSCRIPTION_STATUS,
    type BillingWebhookEvent,
    type ExecutionPackCode,
} from '@neatslip/types';

import { PaymentsService } from './payments.service';
import { CatalogService } from './catalog.service';
import { PAYMENT_PROVIDER } from './interfaces/payment-provider.interface';
import { User } from '../users/schemas/user.schema';
import { ProcessedWebhookEvent } from './schemas/processed-webhook-event.schema';
import { OrphanedProviderCustomer } from './schemas/orphaned-provider-customer.schema';
import { UsersService } from '../users/users.service';

jest.mock('../../config/env', () => ({
    ENV: {
        WEB_URL: 'http://localhost:3000',
        PAYMENTS_SUBSCRIPTION_ENABLED: true,
        PAYMENTS_ONE_OFF_ENABLED: true,
    },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock() requires runtime require()
const envModule = require('../../config/env') as {
    ENV: Record<string, unknown>;
};

// ─── Test catalog data ───────────────────────────────────────────────────────

const TEST_CATALOG = {
    subscriptionPlans: [
        {
            code: 'starter',
            priceId: 'price_test_starter',
            priceAmount: 4900,
            currency: 'usd',
            interval: 'month',
            executions: 10000,
            displayOrder: 1,
            featured: false,
        },
        {
            code: 'pro',
            priceId: 'price_test_pro',
            priceAmount: 14900,
            currency: 'usd',
            interval: 'month',
            executions: 50000,
            displayOrder: 2,
            featured: true,
        },
    ],
    executionPacks: [
        {
            code: 'basic',
            priceId: 'price_test_basic',
            priceAmount: 2900,
            currency: 'usd',
            executions: 5000,
            displayOrder: 1,
            featured: false,
        },
        {
            code: 'max',
            priceId: 'price_test_max',
            priceAmount: 9900,
            currency: 'usd',
            executions: 25000,
            displayOrder: 2,
            featured: true,
        },
    ],
};

const TEST_PRICE_TO_PLAN: Record<string, string> = {
    price_test_starter: 'starter',
    price_test_pro: 'pro',
};

const TEST_PRICE_TO_EXECUTIONS: Record<string, number> = {
    price_test_starter: 10000,
    price_test_pro: 50000,
};

const mockCatalogService = {
    getSubscriptionPlan: jest.fn((code: string) =>
        Promise.resolve(
            TEST_CATALOG.subscriptionPlans.find((p) => p.code === code)
        )
    ),
    getExecutionPack: jest.fn((code: string) =>
        Promise.resolve(
            TEST_CATALOG.executionPacks.find((p) => p.code === code)
        )
    ),
    getPriceToPlanMap: jest.fn().mockResolvedValue(TEST_PRICE_TO_PLAN),
    getPriceToExecutionsMap: jest
        .fn()
        .mockResolvedValue(TEST_PRICE_TO_EXECUTIONS),
    getCatalog: jest.fn().mockResolvedValue(TEST_CATALOG),
};

// ─────────────────────────────────────────────────────────────────────────────

const MOCK_USER_ID = '507f1f77bcf86cd799439011';

const mockUser = (overrides: Record<string, unknown> = {}) => ({
    _id: { toString: () => MOCK_USER_ID },
    email: 'test@example.com',
    preferredLang: 'en',
    billing: null as unknown,
    ...overrides,
});

const mockPaymentProvider = {
    createCheckoutSession: jest.fn(),
    createPortalSession: jest.fn(),
    handleWebhookPayload: jest.fn(),
};

/** Build a chainable Mongoose query mock: .maxTimeMS().lean() */
const chainQuery = (value: unknown) => ({
    maxTimeMS: jest
        .fn()
        .mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }),
    lean: jest.fn().mockResolvedValue(value),
});

const mockUserModel = {
    findById: jest.fn(),
    findOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findOneAndUpdate: jest.fn(),
};

const mockWebhookEventModel = {
    create: jest.fn(),
    findOne: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
};

const mockOrphanModel = {
    create: jest.fn(),
    findOne: jest.fn(),
    deleteOne: jest.fn(),
};

const mockUsersService = {
    addExecutions: jest.fn(),
    recordTransaction: jest.fn(),
    clearTransactions: jest.fn(),
};

describe('PaymentsService', () => {
    let service: PaymentsService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PaymentsService,
                { provide: PAYMENT_PROVIDER, useValue: mockPaymentProvider },
                {
                    provide: getModelToken(User.name),
                    useValue: mockUserModel,
                },
                {
                    provide: getModelToken(ProcessedWebhookEvent.name),
                    useValue: mockWebhookEventModel,
                },
                {
                    provide: getModelToken(OrphanedProviderCustomer.name),
                    useValue: mockOrphanModel,
                },
                { provide: UsersService, useValue: mockUsersService },
                { provide: CatalogService, useValue: mockCatalogService },
            ],
        }).compile();

        service = module.get<PaymentsService>(PaymentsService);
        jest.clearAllMocks();

        // Reset feature flags to defaults
        envModule.ENV.PAYMENTS_SUBSCRIPTION_ENABLED = true;
        envModule.ENV.PAYMENTS_ONE_OFF_ENABLED = true;

        // Default mocks for two-phase idempotency helpers
        mockWebhookEventModel.updateOne.mockResolvedValue({});
        mockWebhookEventModel.deleteOne.mockResolvedValue({});
    });

    // ─── createCheckoutSession (subscription) ─────────────────────────

    describe('createCheckoutSession (subscription)', () => {
        it('should call paymentProvider with correct args and return checkoutUrl', async () => {
            const user = mockUser({ billing: null });
            mockUserModel.findById.mockReturnValue({
                lean: jest.fn().mockResolvedValue(user),
            });
            mockPaymentProvider.createCheckoutSession.mockResolvedValue({
                checkoutUrl: 'https://checkout.stripe.com/test',
                providerSessionId: 'cs_test',
            });

            const result = await service.createCheckoutSession(MOCK_USER_ID, {
                paymentType: PAYMENT_TYPE.SUBSCRIPTION,
                planCode: 'pro',
            });

            expect(
                mockPaymentProvider.createCheckoutSession
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: MOCK_USER_ID,
                    userEmail: user.email,
                    paymentType: PAYMENT_TYPE.SUBSCRIPTION,
                    planCode: 'pro',
                    priceId: 'price_test_pro',
                    executions: 50000,
                    successUrl: 'http://localhost:3000/en/billing/success',
                    cancelUrl: 'http://localhost:3000/en/billing/cancel',
                })
            );
            expect(result).toEqual({
                checkoutUrl: 'https://checkout.stripe.com/test',
            });
        });

        it('should build locale-aware billing URLs from user preferredLang', async () => {
            const user = mockUser({ billing: null });
            mockUserModel.findById.mockReturnValue({
                lean: jest.fn().mockResolvedValue(user),
            });
            mockPaymentProvider.createCheckoutSession.mockResolvedValue({
                checkoutUrl: 'https://checkout.stripe.com/test',
                providerSessionId: 'cs_test',
            });

            await service.createCheckoutSession(MOCK_USER_ID, {
                paymentType: PAYMENT_TYPE.SUBSCRIPTION,
                planCode: 'pro',
            });

            expect(
                mockPaymentProvider.createCheckoutSession
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    successUrl: 'http://localhost:3000/en/billing/success',
                    cancelUrl: 'http://localhost:3000/en/billing/cancel',
                })
            );
        });

        it('should throw ConflictException with ALREADY_SUBSCRIBED when user has active subscription', async () => {
            const user = mockUser({ billing: { hasActiveSubscription: true } });
            mockUserModel.findById.mockReturnValue({
                lean: jest.fn().mockResolvedValue(user),
            });

            const error = await service
                .createCheckoutSession(MOCK_USER_ID, {
                    paymentType: PAYMENT_TYPE.SUBSCRIPTION,
                    planCode: 'pro',
                })
                .catch((e: unknown) => e);

            expect(error).toBeInstanceOf(ConflictException);
            expect((error as ConflictException).getResponse()).toMatchObject({
                code: RESPONSE_CODE.ALREADY_SUBSCRIBED,
            });
        });

        it('should throw BadRequestException when user not found', async () => {
            mockUserModel.findById.mockReturnValue({
                lean: jest.fn().mockResolvedValue(null),
            });

            await expect(
                service.createCheckoutSession(MOCK_USER_ID, {
                    paymentType: PAYMENT_TYPE.SUBSCRIPTION,
                    planCode: 'pro',
                })
            ).rejects.toThrow(BadRequestException);
        });

        it('should throw when PAYMENTS_SUBSCRIPTION_ENABLED is false', async () => {
            envModule.ENV.PAYMENTS_SUBSCRIPTION_ENABLED = false;

            await expect(
                service.createCheckoutSession(MOCK_USER_ID, {
                    paymentType: PAYMENT_TYPE.SUBSCRIPTION,
                    planCode: 'pro',
                })
            ).rejects.toThrow(BadRequestException);
        });
    });

    // ─── createCheckoutSession (one-off) ──────────────────────────────

    describe('createCheckoutSession (one-off)', () => {
        it('should create one-off checkout session for valid packCode', async () => {
            mockUserModel.findById.mockReturnValue({
                lean: () =>
                    Promise.resolve({
                        _id: MOCK_USER_ID,
                        email: 'user@test.com',
                        billing: null,
                    }),
            });
            mockPaymentProvider.createCheckoutSession.mockResolvedValue({
                checkoutUrl: 'https://checkout.stripe.com/one-off',
                providerSessionId: 'cs_test_oneoff',
            });

            const result = await service.createCheckoutSession(MOCK_USER_ID, {
                paymentType: PAYMENT_TYPE.ONE_OFF,
                packCode: 'basic',
            });

            expect(result.checkoutUrl).toBe(
                'https://checkout.stripe.com/one-off'
            );
            expect(
                mockPaymentProvider.createCheckoutSession
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    paymentType: PAYMENT_TYPE.ONE_OFF,
                    planCode: 'basic',
                    priceId: 'price_test_basic',
                    executions: 5000,
                })
            );
        });

        it('should throw BadRequestException for invalid packCode', async () => {
            mockUserModel.findById.mockReturnValue({
                lean: () =>
                    Promise.resolve({
                        _id: MOCK_USER_ID,
                        email: 'user@test.com',
                    }),
            });

            await expect(
                service.createCheckoutSession(MOCK_USER_ID, {
                    paymentType: PAYMENT_TYPE.ONE_OFF,
                    packCode: 'invalid_pack' as ExecutionPackCode,
                })
            ).rejects.toThrow(BadRequestException);
        });

        it('should throw when PAYMENTS_ONE_OFF_ENABLED is false', async () => {
            envModule.ENV.PAYMENTS_ONE_OFF_ENABLED = false;

            await expect(
                service.createCheckoutSession(MOCK_USER_ID, {
                    paymentType: PAYMENT_TYPE.ONE_OFF,
                    packCode: 'basic',
                })
            ).rejects.toThrow(BadRequestException);
        });
    });

    // ─── createPortalSession ─────────────────────────────────────────

    describe('createPortalSession', () => {
        it('should call paymentProvider.createPortalSession with providerCustomerId and return portalUrl', async () => {
            const user = mockUser({
                billing: { providerCustomerId: 'cus_test_xxx' },
            });
            mockUserModel.findById.mockReturnValue({
                lean: jest.fn().mockResolvedValue(user),
            });
            mockPaymentProvider.createPortalSession.mockResolvedValue({
                portalUrl: 'https://billing.stripe.com/test',
            });

            const result = await service.createPortalSession(MOCK_USER_ID);

            expect(
                mockPaymentProvider.createPortalSession
            ).toHaveBeenCalledWith(
                'cus_test_xxx',
                'http://localhost:3000/en/billing'
            );
            expect(result).toEqual({
                portalUrl: 'https://billing.stripe.com/test',
            });
        });

        it('should throw BadRequestException with NO_BILLING_ACCOUNT when billing subdocument is null', async () => {
            const user = mockUser({ billing: null });
            mockUserModel.findById.mockReturnValue({
                lean: jest.fn().mockResolvedValue(user),
            });

            const error = await service
                .createPortalSession(MOCK_USER_ID)
                .catch((e: unknown) => e);

            expect(error).toBeInstanceOf(BadRequestException);
            expect((error as BadRequestException).getResponse()).toMatchObject({
                code: RESPONSE_CODE.NO_BILLING_ACCOUNT,
            });
        });

        it('should throw BadRequestException with NO_BILLING_ACCOUNT when providerCustomerId is null', async () => {
            const user = mockUser({
                billing: { providerCustomerId: null },
            });
            mockUserModel.findById.mockReturnValue({
                lean: jest.fn().mockResolvedValue(user),
            });

            const error = await service
                .createPortalSession(MOCK_USER_ID)
                .catch((e: unknown) => e);

            expect(error).toBeInstanceOf(BadRequestException);
            expect((error as BadRequestException).getResponse()).toMatchObject({
                code: RESPONSE_CODE.NO_BILLING_ACCOUNT,
            });
        });

        it('should throw BadRequestException when user not found', async () => {
            mockUserModel.findById.mockReturnValue({
                lean: jest.fn().mockResolvedValue(null),
            });

            await expect(
                service.createPortalSession(MOCK_USER_ID)
            ).rejects.toThrow(BadRequestException);
        });
    });

    // ─── handleWebhook ───────────────────────────────────────────────

    describe('handleWebhook', () => {
        const rawBody = Buffer.from('{}');
        const signature = 'stripe-sig-test';

        // ── Basic flow ───────────────────────────────────────────────

        describe('basic flow', () => {
            it('should return without action when handleWebhookPayload returns null', async () => {
                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    null
                );

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockWebhookEventModel.create).not.toHaveBeenCalled();
                expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
            });

            it('should process CHECKOUT_COMPLETED event with atomic out-of-order guard', async () => {
                const occurredAt = new Date('2024-01-01');
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.CHECKOUT_COMPLETED,
                    providerEventId: 'evt_test',
                    occurredAt,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    raw: {
                        customer: 'cus_test',
                        subscription: 'sub_test',
                        currency: 'usd',
                        status: 'complete',
                        metadata: { planCode: 'pro' },
                    },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockWebhookEventModel.create).toHaveBeenCalledWith(
                    expect.objectContaining({
                        provider: 'stripe',
                        providerEventId: 'evt_test',
                        type: BILLING_EVENT_TYPE.CHECKOUT_COMPLETED,
                        userId: MOCK_USER_ID,
                        status: 'pending',
                    })
                );
                expect(mockWebhookEventModel.updateOne).toHaveBeenCalledWith(
                    { provider: 'stripe', providerEventId: 'evt_test' },
                    { $set: { status: 'applied' } },
                    { maxTimeMS: 10000 }
                );
                expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledWith(
                    expect.objectContaining({ _id: MOCK_USER_ID }),
                    {
                        $set: expect.objectContaining({
                            'billing.provider': 'stripe',
                            'billing.hasActiveSubscription': true,
                            'billing.providerCustomerId': 'cus_test',
                            'billing.providerSubscriptionId': 'sub_test',
                            'billing.planCode': 'pro',
                            'billing.currency': 'usd',
                        }),
                    },
                    { new: true, maxTimeMS: 10000 }
                );
            });
        });

        // ── userId resolution ────────────────────────────────────────

        describe('userId resolution', () => {
            it('should use event.userId directly when non-empty and not call findOne', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.CHECKOUT_COMPLETED,
                    providerEventId: 'evt_direct_id',
                    occurredAt: new Date(),
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    raw: {},
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUserModel.findOne).not.toHaveBeenCalled();
            });

            it('should look up user by providerSubscriptionId when event.userId is empty', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                    providerEventId: 'evt_sub_lookup',
                    occurredAt: new Date(),
                    userId: '',
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    raw: { id: 'sub_test_xxx', status: 'active' },
                };

                const foundUser = { _id: { toString: () => MOCK_USER_ID } };
                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockUserModel.findOne.mockReturnValue(chainQuery(foundUser));
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUserModel.findOne).toHaveBeenCalledWith({
                    'billing.providerSubscriptionId': 'sub_test_xxx',
                });
            });

            it('should return without action when userId is empty and raw.id is missing', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                    providerEventId: 'evt_no_raw_id',
                    occurredAt: new Date(),
                    userId: '',
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    raw: {},
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockWebhookEventModel.create).not.toHaveBeenCalled();
                expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
            });

            it('should return without action when findOne finds no user for subscriptionId', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                    providerEventId: 'evt_no_user_found',
                    occurredAt: new Date(),
                    userId: '',
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    raw: { id: 'sub_not_found' },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockUserModel.findOne.mockReturnValue(chainQuery(null));

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockWebhookEventModel.create).not.toHaveBeenCalled();
                expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
            });
        });

        // ── Idempotency ──────────────────────────────────────────────

        describe('idempotency', () => {
            it('should skip when duplicate key and existing event is applied', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.CHECKOUT_COMPLETED,
                    providerEventId: 'evt_dup',
                    occurredAt: new Date(),
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    raw: {},
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                const dupError = Object.assign(
                    new Error('E11000 duplicate key'),
                    {
                        code: 11000,
                    }
                );
                mockWebhookEventModel.create.mockRejectedValue(dupError);
                mockWebhookEventModel.findOne.mockReturnValue({
                    lean: jest.fn().mockResolvedValue({ status: 'applied' }),
                });

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
            });

            it('should retry processing when duplicate key and existing event is pending', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.CHECKOUT_COMPLETED,
                    providerEventId: 'evt_retry',
                    occurredAt: new Date(),
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    raw: {
                        customer: 'cus_retry',
                        subscription: 'sub_retry',
                        currency: 'usd',
                        status: 'complete',
                        metadata: { planCode: 'pro' },
                    },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                const dupError = Object.assign(
                    new Error('E11000 duplicate key'),
                    {
                        code: 11000,
                    }
                );
                mockWebhookEventModel.create.mockRejectedValue(dupError);
                mockWebhookEventModel.findOne.mockReturnValue({
                    lean: jest.fn().mockResolvedValue({ status: 'pending' }),
                });
                mockUserModel.findOneAndUpdate.mockResolvedValue({});
                mockWebhookEventModel.updateOne.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUserModel.findOneAndUpdate).toHaveBeenCalled();
                expect(mockWebhookEventModel.updateOne).toHaveBeenCalledWith(
                    { provider: 'stripe', providerEventId: 'evt_retry' },
                    { $set: { status: 'applied' } },
                    { maxTimeMS: 10000 }
                );
            });

            it('should propagate non-duplicate errors from webhookEventModel.create', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.CHECKOUT_COMPLETED,
                    providerEventId: 'evt_err',
                    occurredAt: new Date(),
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    raw: {},
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockRejectedValue(
                    new Error('connection error')
                );

                await expect(
                    service.handleWebhook('stripe', rawBody, signature)
                ).rejects.toThrow('connection error');
            });

            it('should rollback pending event and re-throw when apply fails', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.ONE_OFF_PAYMENT_COMPLETED,
                    providerEventId: 'evt_fail_apply',
                    occurredAt: new Date(),
                    userId: MOCK_USER_ID,
                    executionsAmount: 10,
                    raw: {},
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findById.mockReturnValue(chainQuery(mockUser()));
                mockUsersService.addExecutions.mockRejectedValue(
                    new Error('DB connection lost')
                );
                mockWebhookEventModel.deleteOne.mockResolvedValue({});

                await expect(
                    service.handleWebhook('stripe', rawBody, signature)
                ).rejects.toThrow('DB connection lost');

                expect(mockWebhookEventModel.deleteOne).toHaveBeenCalledWith(
                    {
                        provider: 'stripe',
                        providerEventId: 'evt_fail_apply',
                        status: 'pending',
                    },
                    { maxTimeMS: 10000 }
                );
            });

            it('should re-throw original error even when rollback deleteOne fails', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.ONE_OFF_PAYMENT_COMPLETED,
                    providerEventId: 'evt_double_fail',
                    occurredAt: new Date(),
                    userId: MOCK_USER_ID,
                    executionsAmount: 10,
                    raw: {},
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findById.mockReturnValue(chainQuery(mockUser()));
                mockUsersService.addExecutions.mockRejectedValue(
                    new Error('Original error')
                );
                mockWebhookEventModel.deleteOne.mockRejectedValue(
                    new Error('Rollback failed')
                );

                await expect(
                    service.handleWebhook('stripe', rawBody, signature)
                ).rejects.toThrow('Original error');
            });
        });

        // ── Out-of-order protection ──────────────────────────────────

        describe('out-of-order protection', () => {
            const makeEvent = (occurredAt: Date): BillingWebhookEvent => ({
                type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                providerEventId: 'evt_ooo',
                occurredAt,
                userId: MOCK_USER_ID,
                subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                raw: { status: 'active' },
            });

            it('should include atomic out-of-order guard in findOneAndUpdate filter', async () => {
                const staleAt = new Date('2024-05-31T00:00:00Z');

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    makeEvent(staleAt)
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledWith(
                    {
                        _id: MOCK_USER_ID,
                        billing: { $ne: null },
                        $or: [
                            { 'billing.lastProviderEventAt': null },
                            {
                                'billing.lastProviderEventAt': {
                                    $lte: staleAt,
                                },
                            },
                        ],
                    },
                    expect.objectContaining({ $set: expect.any(Object) }),
                    { new: true, maxTimeMS: 10000 }
                );
            });

            it('should skip when findOneAndUpdate returns null (stale or orphan event)', async () => {
                const staleAt = new Date('2024-05-31T00:00:00Z');

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    makeEvent(staleAt)
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                // findOneAndUpdate returns null — atomic guard rejected the update
                mockUserModel.findOneAndUpdate.mockResolvedValue(null);

                await service.handleWebhook('stripe', rawBody, signature);

                // Event is still marked as applied (stale skip is a valid outcome)
                expect(mockWebhookEventModel.updateOne).toHaveBeenCalledWith(
                    { provider: 'stripe', providerEventId: 'evt_ooo' },
                    { $set: { status: 'applied' } },
                    { maxTimeMS: 10000 }
                );
            });

            it('should apply when findOneAndUpdate returns document (valid event)', async () => {
                const newerAt = new Date('2024-06-01T00:00:00Z');

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    makeEvent(newerAt)
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUserModel.findOneAndUpdate).toHaveBeenCalled();
                expect(mockWebhookEventModel.updateOne).toHaveBeenCalledWith(
                    { provider: 'stripe', providerEventId: 'evt_ooo' },
                    { $set: { status: 'applied' } },
                    { maxTimeMS: 10000 }
                );
            });
        });

        // ── Billing state per event type ─────────────────────────────

        describe('billing state per event type', () => {
            const occurredAt = new Date('2024-01-01T00:00:00Z');

            it('should set correct billing state for CHECKOUT_COMPLETED', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.CHECKOUT_COMPLETED,
                    providerEventId: 'evt_checkout',
                    occurredAt,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    raw: {
                        customer: 'cus_abc',
                        subscription: 'sub_abc',
                        currency: 'usd',
                        status: 'complete',
                        metadata: { planCode: 'pro' },
                    },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledWith(
                    expect.objectContaining({ _id: MOCK_USER_ID }),
                    {
                        $set: expect.objectContaining({
                            'billing.provider': 'stripe',
                            'billing.providerCustomerId': 'cus_abc',
                            'billing.providerSubscriptionId': 'sub_abc',
                            'billing.planCode': 'pro',
                            'billing.currency': 'usd',
                            'billing.hasActiveSubscription': true,
                            'billing.subscriptionStatus':
                                SUBSCRIPTION_STATUS.ACTIVE,
                        }),
                    },
                    { new: true, maxTimeMS: 10000 }
                );
            });

            it('should set hasActiveSubscription=true and update currentPeriodEnd for SUBSCRIPTION_UPDATED with ACTIVE status', async () => {
                const currentPeriodEnd = new Date('2025-01-01T00:00:00Z');
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                    providerEventId: 'evt_updated_active',
                    occurredAt,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodEnd,
                    cancelAtPeriodEnd: false,
                    raw: { status: 'active' },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledWith(
                    expect.objectContaining({ _id: MOCK_USER_ID }),
                    {
                        $set: expect.objectContaining({
                            'billing.hasActiveSubscription': true,
                            'billing.subscriptionStatus':
                                SUBSCRIPTION_STATUS.ACTIVE,
                            'billing.currentPeriodEnd': currentPeriodEnd,
                            'billing.cancelAtPeriodEnd': false,
                        }),
                    },
                    { new: true, maxTimeMS: 10000 }
                );
            });

            it('should set hasActiveSubscription=true for SUBSCRIPTION_UPDATED with TRIALING status', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                    providerEventId: 'evt_trialing',
                    occurredAt,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.TRIALING,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    raw: { status: 'trialing' },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledWith(
                    expect.objectContaining({ _id: MOCK_USER_ID }),
                    {
                        $set: expect.objectContaining({
                            'billing.hasActiveSubscription': true,
                            'billing.subscriptionStatus':
                                SUBSCRIPTION_STATUS.TRIALING,
                        }),
                    },
                    { new: true, maxTimeMS: 10000 }
                );
            });

            it('should set hasActiveSubscription=false for SUBSCRIPTION_UPDATED with PAST_DUE status', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                    providerEventId: 'evt_past_due',
                    occurredAt,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    raw: { status: 'past_due' },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledWith(
                    expect.objectContaining({ _id: MOCK_USER_ID }),
                    {
                        $set: expect.objectContaining({
                            'billing.hasActiveSubscription': false,
                            'billing.subscriptionStatus':
                                SUBSCRIPTION_STATUS.PAST_DUE,
                        }),
                    },
                    { new: true, maxTimeMS: 10000 }
                );
            });

            it('should update planCode when SUBSCRIPTION_UPDATED contains a known priceId (plan switch)', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                    providerEventId: 'evt_plan_switch',
                    occurredAt,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    raw: {
                        status: 'active',
                        items: {
                            data: [{ price: { id: 'price_test_starter' } }],
                        },
                    },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledWith(
                    expect.objectContaining({ _id: MOCK_USER_ID }),
                    {
                        $set: expect.objectContaining({
                            'billing.planCode': 'starter',
                            'billing.hasActiveSubscription': true,
                        }),
                    },
                    { new: true, maxTimeMS: 10000 }
                );
            });

            it('should not set planCode when SUBSCRIPTION_UPDATED has unknown priceId', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                    providerEventId: 'evt_unknown_price',
                    occurredAt,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    raw: {
                        status: 'active',
                        items: {
                            data: [{ price: { id: 'price_unknown_xxx' } }],
                        },
                    },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledWith(
                    expect.objectContaining({ _id: MOCK_USER_ID }),
                    {
                        $set: expect.not.objectContaining({
                            'billing.planCode': expect.anything(),
                        }),
                    },
                    { new: true, maxTimeMS: 10000 }
                );
            });

            it('should set canceled state for SUBSCRIPTION_DELETED', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.SUBSCRIPTION_DELETED,
                    providerEventId: 'evt_deleted',
                    occurredAt,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.CANCELED,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    raw: {},
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledWith(
                    expect.objectContaining({ _id: MOCK_USER_ID }),
                    {
                        $set: expect.objectContaining({
                            'billing.subscriptionStatus':
                                SUBSCRIPTION_STATUS.CANCELED,
                            'billing.hasActiveSubscription': false,
                            'billing.providerSubscriptionStatus': 'canceled',
                        }),
                    },
                    { new: true, maxTimeMS: 10000 }
                );
            });

            it('should fall through to Phase 2 (full subdocument set) when billing is null', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.CHECKOUT_COMPLETED,
                    providerEventId: 'evt_billing_null',
                    occurredAt,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    raw: {
                        customer: 'cus_first',
                        subscription: 'sub_first',
                        currency: 'usd',
                        status: 'complete',
                        metadata: { planCode: 'pro' },
                    },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                // Phase 1 returns null (billing is null, so $ne: null doesn't match)
                mockUserModel.findOneAndUpdate
                    .mockResolvedValueOnce(null)
                    .mockResolvedValueOnce({});

                await service.handleWebhook('stripe', rawBody, signature);

                // Phase 1: dot-notation attempt with billing: { $ne: null }
                expect(mockUserModel.findOneAndUpdate).toHaveBeenNthCalledWith(
                    1,
                    expect.objectContaining({
                        _id: MOCK_USER_ID,
                        billing: { $ne: null },
                    }),
                    {
                        $set: expect.objectContaining({
                            'billing.provider': 'stripe',
                        }),
                    },
                    { new: true, maxTimeMS: 10000 }
                );

                // Phase 2: full subdocument set with billing: null filter
                expect(mockUserModel.findOneAndUpdate).toHaveBeenNthCalledWith(
                    2,
                    { _id: MOCK_USER_ID, billing: null },
                    {
                        $set: {
                            billing: expect.objectContaining({
                                provider: 'stripe',
                                providerCustomerId: 'cus_first',
                                providerSubscriptionId: 'sub_first',
                                hasActiveSubscription: true,
                            }),
                        },
                    },
                    { new: true, maxTimeMS: 10000 }
                );
            });

            it('should always use dot-notation $set for atomic updates', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                    providerEventId: 'evt_dot',
                    occurredAt,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    raw: { status: 'past_due' },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                const [, update] = mockUserModel.findOneAndUpdate.mock
                    .calls[0] as [unknown, { $set: Record<string, unknown> }];
                // All keys in $set must be dot-notation billing paths
                for (const key of Object.keys(update.$set)) {
                    expect(key).toMatch(/^billing\./);
                }
            });
        });

        // ── Subscription executions (atomic pipeline) ────────────────

        /**
         * Extracts the execution adjustment amount embedded in a
         * findOneAndUpdate aggregation pipeline call, or null if the
         * update was a plain object (no execution adjustment).
         */
        const pipelineAdjustment = (callIndex = 0): number | null => {
            const update =
                mockUserModel.findOneAndUpdate.mock.calls[callIndex]?.[1];
            if (!Array.isArray(update)) return null;
            try {
                const stage = update[0] as Record<
                    string,
                    Record<string, unknown>
                >;
                const balance = stage.$set['executions.balance'] as {
                    $cond: {
                        then: { $max: [number, { $add: [string, number] }] };
                    };
                };
                return balance.$cond.then.$max[1].$add[1];
            } catch {
                return null;
            }
        };

        describe('subscription executions', () => {
            const occurredAt = new Date('2024-01-01T00:00:00Z');

            it('should include execution adjustment in atomic pipeline on CHECKOUT_COMPLETED', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.CHECKOUT_COMPLETED,
                    providerEventId: 'evt_sub_credits',
                    occurredAt,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    executionsAmount: 10000,
                    raw: {
                        customer: 'cus_credits',
                        subscription: 'sub_credits',
                        currency: 'usd',
                        status: 'complete',
                        metadata: { planCode: 'starter', executions: '10000' },
                    },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue(
                    mockUser({ executions: { balance: 10000 } })
                );
                mockUsersService.recordTransaction.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                // Execution adjustment is inside the atomic pipeline, NOT a separate call
                expect(mockUsersService.addExecutions).not.toHaveBeenCalled();
                expect(pipelineAdjustment()).toBe(10000);
                expect(mockUserModel.findById).not.toHaveBeenCalled();
                expect(mockUsersService.recordTransaction).toHaveBeenCalledWith(
                    expect.objectContaining({
                        userId: MOCK_USER_ID,
                        type: 'credit',
                        action: 'subscription_activation',
                        amount: 10000,
                        balanceAfter: 10000,
                    })
                );
            });

            it('should use plain $set on CHECKOUT_COMPLETED when executionsAmount is missing', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.CHECKOUT_COMPLETED,
                    providerEventId: 'evt_sub_no_credits',
                    occurredAt,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    raw: {
                        customer: 'cus_no_credits',
                        subscription: 'sub_no_credits',
                        currency: 'usd',
                        status: 'complete',
                        metadata: { planCode: 'pro' },
                    },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUsersService.addExecutions).not.toHaveBeenCalled();
                expect(pipelineAdjustment()).toBeNull();
            });

            it('should use plain $set on SUBSCRIPTION_UPDATED without plan change', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                    providerEventId: 'evt_sub_updated_no_credits',
                    occurredAt,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    raw: { status: 'active' },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUsersService.addExecutions).not.toHaveBeenCalled();
                expect(pipelineAdjustment()).toBeNull();
            });
        });

        // ── Plan change proration (atomic pipeline) ──────────────────

        describe('plan change proration', () => {
            // Period: 30 days, event occurs at day 15 → remainingRatio = 0.5
            const periodStart = new Date('2024-01-01T00:00:00Z');
            const periodEnd = new Date('2024-01-31T00:00:00Z');
            const midPeriod = new Date('2024-01-16T00:00:00Z');

            it('should include prorated upgrade adjustment in atomic pipeline (starter → pro)', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                    providerEventId: 'evt_upgrade',
                    occurredAt: midPeriod,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodStart: periodStart,
                    currentPeriodEnd: periodEnd,
                    cancelAtPeriodEnd: false,
                    previousPriceId: 'price_test_starter',
                    raw: {
                        status: 'active',
                        items: {
                            data: [{ price: { id: 'price_test_pro' } }],
                        },
                    },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue(
                    mockUser({ executions: { balance: 30000 } })
                );
                mockUsersService.recordTransaction.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                // delta = 50000 - 10000 = 40000, ratio ≈ 0.5, adjustment = floor(40000 * 0.5) = 20000
                expect(mockUsersService.addExecutions).not.toHaveBeenCalled();
                expect(pipelineAdjustment()).toBe(20000);
                expect(mockUserModel.findById).not.toHaveBeenCalled();
                expect(mockUsersService.recordTransaction).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'credit',
                        action: 'plan_change',
                        amount: 20000,
                        balanceAfter: 30000,
                    })
                );
            });

            it('should include prorated downgrade adjustment in atomic pipeline (pro → starter)', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                    providerEventId: 'evt_downgrade',
                    occurredAt: midPeriod,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodStart: periodStart,
                    currentPeriodEnd: periodEnd,
                    cancelAtPeriodEnd: false,
                    previousPriceId: 'price_test_pro',
                    raw: {
                        status: 'active',
                        items: {
                            data: [{ price: { id: 'price_test_starter' } }],
                        },
                    },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue(
                    mockUser({ executions: { balance: 30000 } })
                );
                mockUsersService.recordTransaction.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                // delta = 10000 - 50000 = -40000, ratio ≈ 0.5, adjustment = -20000
                expect(pipelineAdjustment()).toBe(-20000);
                expect(mockUserModel.findById).not.toHaveBeenCalled();
                expect(mockUsersService.recordTransaction).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'debit',
                        action: 'plan_change',
                        amount: 20000,
                        balanceAfter: 30000,
                    })
                );
            });

            it('should use plain $set when previousPriceId is absent (no plan change)', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                    providerEventId: 'evt_no_change',
                    occurredAt: midPeriod,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodStart: periodStart,
                    currentPeriodEnd: periodEnd,
                    cancelAtPeriodEnd: false,
                    raw: {
                        status: 'active',
                        items: {
                            data: [{ price: { id: 'price_test_pro' } }],
                        },
                    },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                expect(pipelineAdjustment()).toBeNull();
            });

            it('should use plain $set when previousPriceId equals current priceId', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                    providerEventId: 'evt_same_price',
                    occurredAt: midPeriod,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodStart: periodStart,
                    currentPeriodEnd: periodEnd,
                    cancelAtPeriodEnd: false,
                    previousPriceId: 'price_test_pro',
                    raw: {
                        status: 'active',
                        items: {
                            data: [{ price: { id: 'price_test_pro' } }],
                        },
                    },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                expect(pipelineAdjustment()).toBeNull();
            });

            it('should use plain $set when price is unknown in catalog', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                    providerEventId: 'evt_unknown_plan',
                    occurredAt: midPeriod,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodStart: periodStart,
                    currentPeriodEnd: periodEnd,
                    cancelAtPeriodEnd: false,
                    previousPriceId: 'price_unknown_old',
                    raw: {
                        status: 'active',
                        items: {
                            data: [{ price: { id: 'price_test_pro' } }],
                        },
                    },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                expect(pipelineAdjustment()).toBeNull();
            });

            it('should use full delta when period boundaries are missing', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                    providerEventId: 'evt_no_period',
                    occurredAt: midPeriod,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    previousPriceId: 'price_test_starter',
                    raw: {
                        status: 'active',
                        items: {
                            data: [{ price: { id: 'price_test_pro' } }],
                        },
                    },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue(
                    mockUser({ executions: { balance: 50000 } })
                );
                mockUsersService.recordTransaction.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                // No period info → ratio = 1.0 → full delta = 40000
                expect(pipelineAdjustment()).toBe(40000);
                expect(mockUserModel.findById).not.toHaveBeenCalled();
                expect(mockUsersService.recordTransaction).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'credit',
                        action: 'plan_change',
                        amount: 40000,
                        balanceAfter: 50000,
                    })
                );
            });

            it('should floor the prorated adjustment', async () => {
                // Period: 30 days, event at day 10 → remaining 20/30 ≈ 0.6667
                const earlyEvent = new Date('2024-01-11T00:00:00Z');
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                    providerEventId: 'evt_floor',
                    occurredAt: earlyEvent,
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodStart: periodStart,
                    currentPeriodEnd: periodEnd,
                    cancelAtPeriodEnd: false,
                    previousPriceId: 'price_test_starter',
                    raw: {
                        status: 'active',
                        items: {
                            data: [{ price: { id: 'price_test_pro' } }],
                        },
                    },
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findOneAndUpdate.mockResolvedValue(
                    mockUser({ executions: { balance: 36666 } })
                );
                mockUsersService.recordTransaction.mockResolvedValue({});

                await service.handleWebhook('stripe', rawBody, signature);

                // delta = 40000, remaining = 20 days out of 30 → ratio = 20/30
                // adjustment = floor(40000 * 20/30) = floor(26666.67) = 26666
                expect(pipelineAdjustment()).toBe(26666);
                expect(mockUserModel.findById).not.toHaveBeenCalled();
                expect(mockUsersService.recordTransaction).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'credit',
                        action: 'plan_change',
                        amount: 26666,
                        balanceAfter: 36666,
                    })
                );
            });
        });

        // ── One-off webhook flow ─────────────────────────────────────

        describe('one-off webhook flow', () => {
            const oneOffEvent: BillingWebhookEvent = {
                type: BILLING_EVENT_TYPE.ONE_OFF_PAYMENT_COMPLETED,
                providerEventId: 'evt_oneoff_123',
                occurredAt: new Date('2026-03-01'),
                userId: MOCK_USER_ID,
                executionsAmount: 5,
                raw: {},
            };

            it('should add executions on ONE_OFF_PAYMENT_COMPLETED', async () => {
                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    oneOffEvent
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findById.mockReturnValue(chainQuery(mockUser()));
                mockUsersService.addExecutions.mockResolvedValue(undefined);

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUsersService.addExecutions).toHaveBeenCalledWith(
                    MOCK_USER_ID,
                    5,
                    'pack_purchase'
                );
                expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
            });

            it('should NOT apply out-of-order check for one-off events', async () => {
                const staleUserBilling = {
                    lastProviderEventAt: new Date('2026-03-15'),
                };
                mockPaymentProvider.handleWebhookPayload.mockResolvedValue({
                    ...oneOffEvent,
                    occurredAt: new Date('2026-02-01'),
                });
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findById.mockReturnValue(
                    chainQuery(mockUser({ billing: staleUserBilling }))
                );
                mockUsersService.addExecutions.mockResolvedValue(undefined);

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUsersService.addExecutions).toHaveBeenCalledWith(
                    MOCK_USER_ID,
                    5,
                    'pack_purchase'
                );
            });

            it('should warn and skip if executionsAmount is 0', async () => {
                mockPaymentProvider.handleWebhookPayload.mockResolvedValue({
                    ...oneOffEvent,
                    executionsAmount: 0,
                });
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findById.mockReturnValue(chainQuery(mockUser()));

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUsersService.addExecutions).not.toHaveBeenCalled();
            });

            it('should skip if executionsAmount is undefined', async () => {
                mockPaymentProvider.handleWebhookPayload.mockResolvedValue({
                    ...oneOffEvent,
                    executionsAmount: undefined,
                });
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findById.mockReturnValue(chainQuery(mockUser()));

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUsersService.addExecutions).not.toHaveBeenCalled();
            });

            it('should skip if executionsAmount is negative', async () => {
                mockPaymentProvider.handleWebhookPayload.mockResolvedValue({
                    ...oneOffEvent,
                    executionsAmount: -5,
                });
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findById.mockReturnValue(chainQuery(mockUser()));

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUsersService.addExecutions).not.toHaveBeenCalled();
            });
        });

        // ── User not found after idempotency ─────────────────────────

        describe('user not found after idempotency check', () => {
            it('should skip subscription billing update and mark applied when findOneAndUpdate returns null (orphan user)', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.CHECKOUT_COMPLETED,
                    providerEventId: 'evt_ghost_user',
                    occurredAt: new Date(),
                    userId: MOCK_USER_ID,
                    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    raw: {},
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                // findOneAndUpdate returns null — user not found or stale
                mockUserModel.findOneAndUpdate.mockResolvedValue(null);

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockWebhookEventModel.updateOne).toHaveBeenCalledWith(
                    { provider: 'stripe', providerEventId: 'evt_ghost_user' },
                    { $set: { status: 'applied' } },
                    { maxTimeMS: 10000 }
                );
            });

            it('should skip one-off executions and mark applied when findById returns null', async () => {
                const event: BillingWebhookEvent = {
                    type: BILLING_EVENT_TYPE.ONE_OFF_PAYMENT_COMPLETED,
                    providerEventId: 'evt_ghost_oneoff',
                    occurredAt: new Date(),
                    userId: MOCK_USER_ID,
                    executionsAmount: 5,
                    raw: {},
                };

                mockPaymentProvider.handleWebhookPayload.mockResolvedValue(
                    event
                );
                mockWebhookEventModel.create.mockResolvedValue({});
                mockUserModel.findById.mockReturnValue(chainQuery(null));

                await service.handleWebhook('stripe', rawBody, signature);

                expect(mockUsersService.addExecutions).not.toHaveBeenCalled();
                expect(mockWebhookEventModel.updateOne).toHaveBeenCalledWith(
                    { provider: 'stripe', providerEventId: 'evt_ghost_oneoff' },
                    { $set: { status: 'applied' } },
                    { maxTimeMS: 10000 }
                );
            });
        });
    });
});
