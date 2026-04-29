jest.mock('./client', () => ({
    apiClient: { post: jest.fn(), get: jest.fn() },
}));

import { apiClient } from './client';
import { PAYMENT_TYPE } from '@neatslip/types';
import {
    getCatalog,
    createSubscriptionCheckout,
    createOneOffCheckout,
    createPortalSession,
} from './payments';

// ─────────────────────────────────────────────────────────────────────────────

const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

const PLAN_CODES = ['starter', 'pro'] as const;
const PACK_CODES = ['basic', 'max'] as const;

// ─────────────────────────────────────────────────────────────────────────────

describe('payments api', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ─── getCatalog ─────────────────────────────────────────────────────

    describe('getCatalog', () => {
        it('should GET /payments/catalog and return data', async () => {
            const catalog = {
                subscriptionPlans: [{ code: 'starter' }],
                executionPacks: [{ code: 'basic' }],
            };
            mockGet.mockResolvedValue({ data: { data: catalog } });

            const result = await getCatalog();

            expect(mockGet).toHaveBeenCalledWith('/payments/catalog');
            expect(result).toEqual(catalog);
        });

        it('should propagate errors from apiClient.get', async () => {
            mockGet.mockRejectedValue(new Error('Network error'));

            await expect(getCatalog()).rejects.toThrow('Network error');
        });
    });

    // ─── createSubscriptionCheckout ───────────────────────────────────

    describe('createSubscriptionCheckout', () => {
        it.each(PLAN_CODES)(
            'should POST to /api/payments/checkout-session with paymentType and planCode for %s',
            async (code) => {
                mockPost.mockResolvedValue({
                    data: { data: { checkoutUrl: 'https://checkout.stripe.com/test' } },
                });

                await createSubscriptionCheckout(code);

                expect(mockPost).toHaveBeenCalledWith(
                    '/payments/checkout-session',
                    {
                        paymentType: PAYMENT_TYPE.SUBSCRIPTION,
                        planCode: code,
                    },
                );
            },
        );

        it.each(PLAN_CODES)(
            'should return { checkoutUrl } extracted from response.data.data for %s',
            async (code) => {
                mockPost.mockResolvedValue({
                    data: { data: { checkoutUrl: 'https://checkout.stripe.com/test' } },
                });

                const result = await createSubscriptionCheckout(code);

                expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/test' });
            },
        );

        it.each(PLAN_CODES)(
            'should propagate errors from apiClient.post for %s',
            async (code) => {
                mockPost.mockRejectedValue(new Error('Network error'));

                await expect(createSubscriptionCheckout(code)).rejects.toThrow(
                    'Network error',
                );
            },
        );
    });

    // ─── createOneOffCheckout ─────────────────────────────────────────

    describe('createOneOffCheckout', () => {
        it.each(PACK_CODES)(
            'should POST to /api/payments/checkout-session with paymentType and packCode for %s',
            async (code) => {
                mockPost.mockResolvedValue({
                    data: { data: { checkoutUrl: 'https://checkout.stripe.com/oneoff' } },
                });

                await createOneOffCheckout(code);

                expect(mockPost).toHaveBeenCalledWith(
                    '/payments/checkout-session',
                    {
                        paymentType: PAYMENT_TYPE.ONE_OFF,
                        packCode: code,
                    },
                );
            },
        );

        it.each(PACK_CODES)(
            'should return { checkoutUrl } extracted from response.data.data for %s',
            async (code) => {
                mockPost.mockResolvedValue({
                    data: { data: { checkoutUrl: 'https://checkout.stripe.com/oneoff' } },
                });

                const result = await createOneOffCheckout(code);

                expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/oneoff' });
            },
        );

        it.each(PACK_CODES)(
            'should propagate errors from apiClient.post for %s',
            async (code) => {
                mockPost.mockRejectedValue(new Error('Payment failed'));

                await expect(createOneOffCheckout(code)).rejects.toThrow(
                    'Payment failed',
                );
            },
        );
    });

    // ─── createPortalSession ──────────────────────────────────────────

    describe('createPortalSession', () => {
        it('should POST to /api/payments/portal-session without body', async () => {
            mockPost.mockResolvedValue({
                data: { data: { portalUrl: 'https://billing.stripe.com/test' } },
            });

            await createPortalSession();

            expect(mockPost).toHaveBeenCalledWith('/payments/portal-session');
        });

        it('should return { portalUrl } extracted from response.data.data', async () => {
            mockPost.mockResolvedValue({
                data: { data: { portalUrl: 'https://billing.stripe.com/test' } },
            });

            const result = await createPortalSession();

            expect(result).toEqual({ portalUrl: 'https://billing.stripe.com/test' });
        });

        it('should propagate errors from apiClient.post', async () => {
            mockPost.mockRejectedValue(new Error('Server error'));

            await expect(createPortalSession()).rejects.toThrow('Server error');
        });
    });
});
