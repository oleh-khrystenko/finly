import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { CatalogService } from './catalog.service';

jest.mock('../../config/env', () => ({
    ENV: {
        WEB_URL: 'http://localhost:3000',
        PAYMENTS_SUBSCRIPTION_ENABLED: true,
        PAYMENTS_ONE_OFF_ENABLED: true,
    },
}));

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

const mockCatalogService = {
    getCatalog: jest.fn().mockResolvedValue(TEST_CATALOG),
    getSubscriptionPlan: jest.fn(),
    getExecutionPack: jest.fn(),
    getPriceToPlanMap: jest.fn(),
};

// ─────────────────────────────────────────────────────────────────────────────

const mockUser = {
    _id: { toString: () => '507f1f77bcf86cd799439011' },
    email: 'test@example.com',
};

const mockPaymentsService = {
    createCheckoutSession: jest.fn(),
    createPortalSession: jest.fn(),
    handleWebhook: jest.fn(),
};

describe('PaymentsController', () => {
    let controller: PaymentsController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [PaymentsController],
            providers: [
                { provide: PaymentsService, useValue: mockPaymentsService },
                { provide: CatalogService, useValue: mockCatalogService },
            ],
        }).compile();

        controller = module.get<PaymentsController>(PaymentsController);
        jest.clearAllMocks();
    });

    // ─── GET /payments/catalog ───────────────────────────────────────

    describe('GET /payments/catalog', () => {
        it('should return catalog data with subscriptionPlans and executionPacks', async () => {
            const result = await controller.getCatalog();

            expect(mockCatalogService.getCatalog).toHaveBeenCalled();
            expect(result).toEqual({
                data: {
                    subscriptionPlans: TEST_CATALOG.subscriptionPlans,
                    executionPacks: TEST_CATALOG.executionPacks,
                },
            });
        });
    });

    // ─── POST /payments/checkout-session ────────────────────────────

    describe('POST /payments/checkout-session', () => {
        it('should create checkout session with subscription type', async () => {
            const dto = {
                paymentType: 'subscription' as const,
                planCode: 'pro',
            };
            mockPaymentsService.createCheckoutSession.mockResolvedValue({
                checkoutUrl: 'https://checkout.stripe.com/test',
            });

            const result = await controller.createCheckoutSession(
                mockUser as any,
                dto as any
            );

            expect(
                mockPaymentsService.createCheckoutSession
            ).toHaveBeenCalledWith('507f1f77bcf86cd799439011', dto);
            expect(result).toEqual({
                data: { checkoutUrl: 'https://checkout.stripe.com/test' },
            });
        });

        it('should create checkout session with one-off type', async () => {
            const dto = {
                paymentType: 'one_off' as const,
                packCode: 'basic' as const,
            };
            mockPaymentsService.createCheckoutSession.mockResolvedValue({
                checkoutUrl: 'https://checkout.stripe.com/oneoff',
            });

            const result = await controller.createCheckoutSession(
                mockUser as any,
                dto as any
            );

            expect(
                mockPaymentsService.createCheckoutSession
            ).toHaveBeenCalledWith('507f1f77bcf86cd799439011', dto);
            expect(result).toEqual({
                data: { checkoutUrl: 'https://checkout.stripe.com/oneoff' },
            });
        });
    });

    // ─── POST /payments/portal-session ──────────────────────────────

    describe('POST /payments/portal-session', () => {
        it('should call paymentsService.createPortalSession with userId and return portalUrl', async () => {
            mockPaymentsService.createPortalSession.mockResolvedValue({
                portalUrl: 'https://billing.stripe.com/test',
            });

            const result = await controller.createPortalSession(
                mockUser as any
            );

            expect(
                mockPaymentsService.createPortalSession
            ).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
            expect(result).toEqual({
                data: { portalUrl: 'https://billing.stripe.com/test' },
            });
        });
    });

    // ─── POST /payments/webhook/:provider ───────────────────────────

    describe('POST /payments/webhook/:provider', () => {
        it('should pass provider, rawBody, and signature to paymentsService.handleWebhook and return { received: true }', async () => {
            const rawBody = Buffer.from(
                '{"type":"checkout.session.completed"}'
            );
            const signature = 'stripe-sig-test';
            const req = { rawBody } as any;

            mockPaymentsService.handleWebhook.mockResolvedValue(undefined);

            const result = await controller.handleWebhook(
                'stripe',
                req,
                signature
            );

            expect(mockPaymentsService.handleWebhook).toHaveBeenCalledWith(
                'stripe',
                rawBody,
                signature
            );
            expect(result).toEqual({ received: true });
        });

        it('should throw BadRequestException when rawBody is missing', async () => {
            const req = { rawBody: undefined } as any;

            await expect(
                controller.handleWebhook('stripe', req, 'stripe-sig')
            ).rejects.toThrow(BadRequestException);
        });

        it('should throw BadRequestException when stripe-signature header is missing', async () => {
            const req = { rawBody: Buffer.from('{}') } as any;

            await expect(
                controller.handleWebhook('stripe', req, undefined as any)
            ).rejects.toThrow(BadRequestException);
        });

        it('should throw BadRequestException for unsupported provider', async () => {
            const req = { rawBody: Buffer.from('{}') } as any;

            await expect(
                controller.handleWebhook('unknown', req, 'some-sig')
            ).rejects.toThrow(BadRequestException);
        });

        it('should include provider name in BadRequestException message for unsupported provider', async () => {
            const req = { rawBody: Buffer.from('{}') } as any;

            const error = await controller
                .handleWebhook('monobank', req, 'some-sig')
                .catch((e: unknown) => e);

            expect(error).toBeInstanceOf(BadRequestException);
            expect((error as BadRequestException).message).toBe(
                'Unsupported provider: monobank'
            );
        });
    });
});
