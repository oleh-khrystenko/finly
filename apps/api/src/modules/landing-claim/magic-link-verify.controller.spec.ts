import { Test, TestingModule } from '@nestjs/testing';
import { MAGIC_LINK_PURPOSE } from '@finly/types';

import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
import { LandingClaimService } from './landing-claim.service';
import { MagicLinkVerifyController } from './magic-link-verify.controller';

jest.mock('../../config/env', () => ({
    ENV: {
        NODE_ENV: 'development',
        WEB_URL: 'http://localhost:3000',
    },
}));

const mockUser = {
    id: '507f1f77bcf86cd799439011',
    _id: { toString: () => '507f1f77bcf86cd799439011' },
    email: 'test@gmail.com',
    profile: { name: 'John Doe' },
    executions: { balance: 0, freeReportUsed: false },
    passwordHash: '$2b$10$hash',
    deletedAt: null as Date | null,
};

const mockAuthService = {
    verifyMagicLink: jest.fn(),
};

const mockUsersService = {
    stampAcceptedTerms: jest.fn(),
};

const mockLandingClaimService = {
    attemptLandingClaim: jest.fn(),
};

const createMockResponse = () => ({
    cookie: jest.fn(),
    clearCookie: jest.fn(),
});

describe('MagicLinkVerifyController', () => {
    let controller: MagicLinkVerifyController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [MagicLinkVerifyController],
            providers: [
                { provide: AuthService, useValue: mockAuthService },
                { provide: UsersService, useValue: mockUsersService },
                {
                    provide: LandingClaimService,
                    useValue: mockLandingClaimService,
                },
            ],
        }).compile();

        controller = module.get<MagicLinkVerifyController>(
            MagicLinkVerifyController
        );
        jest.clearAllMocks();
    });

    describe('POST /auth/magic-link/verify (Sprint 13 orchestration)', () => {
        const DRAFT = {
            receiverName: 'Іваненко',
            iban: 'UA213223130000026007233566001',
            taxId: '1234567899',
            purpose: 'Оплата',
        } as const;
        const KEY = '00000000-0000-4000-8000-000000000000';

        const baseResult = (
            rawPayload: {
                termsVersion?: string;
                landingDraft?: typeof DRAFT;
                claimIdempotencyKey?: string;
            } = {},
            overrides: { worksAsBookkeeper?: boolean } = {}
        ) => ({
            user: {
                ...mockUser,
                ...overrides,
            },
            tokens: {
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
            },
            purpose: 'login',
            deleted: false,
            rawPayload,
        });

        it('(a) login без draft без termsVersion — claim=null, stamp/claim не викликаються', async () => {
            mockAuthService.verifyMagicLink.mockResolvedValue(baseResult());
            const res = createMockResponse();

            const result = await controller.verifyMagicLink(
                { token: 'abc123' } as any,
                res as any
            );

            expect(mockUsersService.stampAcceptedTerms).not.toHaveBeenCalled();
            expect(
                mockLandingClaimService.attemptLandingClaim
            ).not.toHaveBeenCalled();
            expect(res.cookie).toHaveBeenCalledWith(
                'bid_refresh',
                'refresh-token',
                expect.objectContaining({ httpOnly: true })
            );
            expect(result.data).toMatchObject({
                accessToken: 'access-token',
                purpose: 'login',
                claim: null,
            });
        });

        it('(b) login з termsVersion — stamp викликається, claim=null', async () => {
            mockAuthService.verifyMagicLink.mockResolvedValue(
                baseResult({ termsVersion: 'v3' })
            );
            const res = createMockResponse();

            const result = await controller.verifyMagicLink(
                { token: 'abc123' } as any,
                res as any
            );

            expect(mockUsersService.stampAcceptedTerms).toHaveBeenCalledWith(
                '507f1f77bcf86cd799439011',
                'v3'
            );
            expect(
                mockLandingClaimService.attemptLandingClaim
            ).not.toHaveBeenCalled();
            expect((result.data as any).claim).toBeNull();
        });

        it('(c) magic-link з draft → claim-success — claim.state=success у response', async () => {
            mockAuthService.verifyMagicLink.mockResolvedValue(
                baseResult(
                    {
                        landingDraft: DRAFT,
                        claimIdempotencyKey: KEY,
                    },
                    { worksAsBookkeeper: false }
                )
            );
            mockLandingClaimService.attemptLandingClaim.mockResolvedValue({
                state: 'success',
                claimedBusinessSlug: 'BizSlug1',
                claimedAccountSlug: 'AcctSlg1',
            });
            const res = createMockResponse();

            const result = await controller.verifyMagicLink(
                { token: 'abc123' } as any,
                res as any
            );

            expect(
                mockLandingClaimService.attemptLandingClaim
            ).toHaveBeenCalledWith(
                {
                    userId: '507f1f77bcf86cd799439011',
                    isBookkeeperMode: false,
                },
                DRAFT,
                KEY
            );
            expect((result.data as any).claim).toEqual({
                state: 'success',
                claimedBusinessSlug: 'BizSlug1',
                claimedAccountSlug: 'AcctSlg1',
            });
        });

        it('(d) magic-link з draft → account-failed — claim.state=account-failed у response', async () => {
            mockAuthService.verifyMagicLink.mockResolvedValue(
                baseResult({
                    landingDraft: DRAFT,
                    claimIdempotencyKey: KEY,
                })
            );
            mockLandingClaimService.attemptLandingClaim.mockResolvedValue({
                state: 'account-failed',
                partialBusinessSlug: 'PartialBiz',
                failedClaimDraft: DRAFT,
            });
            const res = createMockResponse();

            const result = await controller.verifyMagicLink(
                { token: 'abc123' } as any,
                res as any
            );

            expect((result.data as any).claim).toEqual({
                state: 'account-failed',
                partialBusinessSlug: 'PartialBiz',
                failedClaimDraft: DRAFT,
            });
        });

        it('(e) stamp invoked BEFORE claim when both present (Sprint 10 §SP-12 invariant)', async () => {
            mockAuthService.verifyMagicLink.mockResolvedValue(
                baseResult({
                    landingDraft: DRAFT,
                    claimIdempotencyKey: KEY,
                    termsVersion: 'v3',
                })
            );
            mockLandingClaimService.attemptLandingClaim.mockResolvedValue({
                state: 'success',
                claimedBusinessSlug: 'BizSlug1',
                claimedAccountSlug: 'AcctSlg1',
            });
            const res = createMockResponse();

            await controller.verifyMagicLink(
                { token: 'abc123' } as any,
                res as any
            );

            expect(mockUsersService.stampAcceptedTerms).toHaveBeenCalledWith(
                '507f1f77bcf86cd799439011',
                'v3'
            );
            const stampOrder =
                mockUsersService.stampAcceptedTerms.mock.invocationCallOrder[0];
            const claimOrder =
                mockLandingClaimService.attemptLandingClaim.mock
                    .invocationCallOrder[0];
            expect(stampOrder).toBeLessThan(claimOrder);
        });

        it('(f) worksAsBookkeeper=true пробрасується у LandingClaimService ctx', async () => {
            mockAuthService.verifyMagicLink.mockResolvedValue(
                baseResult(
                    {
                        landingDraft: DRAFT,
                        claimIdempotencyKey: KEY,
                    },
                    { worksAsBookkeeper: true }
                )
            );
            mockLandingClaimService.attemptLandingClaim.mockResolvedValue({
                state: 'success',
                claimedBusinessSlug: 'BizSlug1',
                claimedAccountSlug: 'AcctSlg1',
            });
            const res = createMockResponse();

            await controller.verifyMagicLink(
                { token: 'abc123' } as any,
                res as any
            );

            expect(
                mockLandingClaimService.attemptLandingClaim
            ).toHaveBeenCalledWith(
                {
                    userId: '507f1f77bcf86cd799439011',
                    isBookkeeperMode: true,
                },
                DRAFT,
                KEY
            );
        });

        it('clears cookie and returns deleted response for delete-account purpose', async () => {
            mockAuthService.verifyMagicLink.mockResolvedValue({
                deleted: true,
                message: 'Account scheduled for deletion',
                purpose: MAGIC_LINK_PURPOSE.DELETE_ACCOUNT,
            });
            const res = createMockResponse();

            const result = await controller.verifyMagicLink(
                { token: 'abc123' } as any,
                res as any
            );

            expect(res.clearCookie).toHaveBeenCalledWith('bid_refresh', {
                path: '/',
            });
            expect(res.cookie).not.toHaveBeenCalled();
            expect(mockUsersService.stampAcceptedTerms).not.toHaveBeenCalled();
            expect(
                mockLandingClaimService.attemptLandingClaim
            ).not.toHaveBeenCalled();
            expect(result.data).toEqual({
                deleted: true,
                purpose: MAGIC_LINK_PURPOSE.DELETE_ACCOUNT,
                message: 'Account scheduled for deletion',
            });
        });

        it('reset-password purpose propagated to response', async () => {
            mockAuthService.verifyMagicLink.mockResolvedValue({
                ...baseResult(),
                purpose: 'reset-password',
            });
            const res = createMockResponse();

            const result = await controller.verifyMagicLink(
                { token: 'abc123' } as any,
                res as any
            );

            expect((result.data as any).purpose).toBe('reset-password');
        });
    });
});
