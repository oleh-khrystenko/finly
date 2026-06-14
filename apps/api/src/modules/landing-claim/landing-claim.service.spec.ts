import {
    ConflictException,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RESPONSE_CODE, type LandingDraft } from '@finly/types';

import { AccountsService } from '../accounts/accounts.service';
import { BusinessesService } from '../businesses/businesses.service';
import { UsersService } from '../users/users.service';
import { LandingClaimService } from './landing-claim.service';

describe('LandingClaimService.attemptLandingClaim (Sprint 10 §10.1)', () => {
    let service: LandingClaimService;
    let businessesService: jest.Mocked<{ create: jest.Mock }>;
    let accountsService: jest.Mocked<{
        create: jest.Mock;
        findByBusinessAndIban: jest.Mock;
    }>;
    let usersService: jest.Mocked<{
        setPendingPostLoginTarget: jest.Mock;
        findById: jest.Mock;
    }>;

    const DRAFT: LandingDraft = {
        receiverName: 'Іваненко',
        iban: 'UA213223130000026007233566001',
        taxId: '1234567899',
        purpose: 'Оплата за послуги',
    };
    const KEY = '00000000-0000-4000-8000-000000000000';
    const CTX = {
        userId: '507f1f77bcf86cd799439011',
        isBookkeeperMode: false,
    };

    beforeEach(async () => {
        businessesService = { create: jest.fn() };
        accountsService = {
            create: jest.fn(),
            findByBusinessAndIban: jest.fn(),
        };
        usersService = {
            setPendingPostLoginTarget: jest.fn().mockResolvedValue(undefined),
            // Sprint 19 — claim резолвить рівень доступу claiming-користувача
            // для лімітів create. Без білінгу → 'none' (типовий онбординг).
            findById: jest.fn().mockResolvedValue({ billing: null }),
        };
        const module = await Test.createTestingModule({
            providers: [
                LandingClaimService,
                { provide: BusinessesService, useValue: businessesService },
                { provide: AccountsService, useValue: accountsService },
                { provide: UsersService, useValue: usersService },
            ],
        }).compile();
        service = module.get(LandingClaimService);
    });

    it('success → tuple-result з claimedBusinessSlug + claimedAccountSlug', async () => {
        businessesService.create.mockResolvedValue({
            slug: 'BizSlug1',
            _id: 'biz-id',
        });
        accountsService.create.mockResolvedValue({
            slug: 'AcctSlg1',
            _id: 'acct-id',
        });

        const result = await service.attemptLandingClaim(CTX, DRAFT, KEY);

        expect(result).toEqual({
            state: 'success',
            claimedBusinessSlug: 'BizSlug1',
            claimedAccountSlug: 'AcctSlg1',
        });
        // BusinessesService.create викликаний з mapLandingDraftToCreateBusinessRequest
        // shape: type='individual', claimIdempotencyKey top-level.
        const createDtoArg = businessesService.create.mock.calls[0][1];
        expect(createDtoArg).toMatchObject({
            type: 'individual',
            name: DRAFT.receiverName,
            taxId: DRAFT.taxId,
            paymentPurposeTemplate: DRAFT.purpose,
            claimIdempotencyKey: KEY,
        });
        // AccountsService.create викликаний з draft.iban (без name).
        expect(accountsService.create).toHaveBeenCalledWith(
            expect.objectContaining({ slug: 'BizSlug1' }),
            { iban: DRAFT.iban }
        );
    });

    it('POST1-failure → business-failed shape з failedClaimDraft', async () => {
        businessesService.create.mockRejectedValue(new Error('Mongo timeout'));

        const result = await service.attemptLandingClaim(CTX, DRAFT, KEY);

        expect(result).toEqual({
            state: 'business-failed',
            failedClaimDraft: DRAFT,
        });
        expect(accountsService.create).not.toHaveBeenCalled();
    });

    it('POST2-failure → account-failed shape з partialBusinessSlug + failedClaimDraft', async () => {
        businessesService.create.mockResolvedValue({
            slug: 'PartialBiz',
            _id: 'biz-id',
        });
        accountsService.create.mockRejectedValue(new Error('IBAN duplicate'));

        const result = await service.attemptLandingClaim(CTX, DRAFT, KEY);

        expect(result).toEqual({
            state: 'account-failed',
            partialBusinessSlug: 'PartialBiz',
            failedClaimDraft: DRAFT,
        });
    });

    // ─── Sprint 10 review fix — POST2-replay safety-net ───

    describe('POST2-replay (lost-response retry)', () => {
        it('ACCOUNT_IBAN_DUPLICATE + existing account знайдено → success замість account-failed', async () => {
            businessesService.create.mockResolvedValue({
                slug: 'BizSlug1',
                _id: 'biz-id',
            });
            accountsService.create.mockRejectedValue(
                new ConflictException({
                    code: RESPONSE_CODE.ACCOUNT_IBAN_DUPLICATE,
                    message: 'IBAN already used for this business',
                })
            );
            accountsService.findByBusinessAndIban.mockResolvedValue({
                slug: 'AcctSlg1',
                _id: 'acct-id',
            });

            const result = await service.attemptLandingClaim(CTX, DRAFT, KEY);

            expect(result).toEqual({
                state: 'success',
                claimedBusinessSlug: 'BizSlug1',
                claimedAccountSlug: 'AcctSlg1',
            });
            expect(accountsService.findByBusinessAndIban).toHaveBeenCalledWith(
                'biz-id',
                DRAFT.iban
            );
        });

        it('ACCOUNT_IBAN_DUPLICATE + lookup повертає null (defensive) → fallthrough на account-failed', async () => {
            businessesService.create.mockResolvedValue({
                slug: 'BizSlug1',
                _id: 'biz-id',
            });
            accountsService.create.mockRejectedValue(
                new ConflictException({
                    code: RESPONSE_CODE.ACCOUNT_IBAN_DUPLICATE,
                    message: 'IBAN already used for this business',
                })
            );
            accountsService.findByBusinessAndIban.mockResolvedValue(null);

            const result = await service.attemptLandingClaim(CTX, DRAFT, KEY);

            expect(result).toEqual({
                state: 'account-failed',
                partialBusinessSlug: 'BizSlug1',
                failedClaimDraft: DRAFT,
            });
        });

        it('non-IBAN-duplicate ConflictException — findByBusinessAndIban НЕ викликається', async () => {
            businessesService.create.mockResolvedValue({
                slug: 'BizSlug1',
                _id: 'biz-id',
            });
            accountsService.create.mockRejectedValue(
                new ConflictException({
                    code: RESPONSE_CODE.SLUG_TAKEN,
                    message: 'unrelated conflict',
                })
            );

            const result = await service.attemptLandingClaim(CTX, DRAFT, KEY);

            expect(result.state).toBe('account-failed');
            expect(
                accountsService.findByBusinessAndIban
            ).not.toHaveBeenCalled();
        });

        it('raw Error (не HttpException) — findByBusinessAndIban НЕ викликається', async () => {
            businessesService.create.mockResolvedValue({
                slug: 'BizSlug1',
                _id: 'biz-id',
            });
            accountsService.create.mockRejectedValue(
                new Error('Mongo connection drop')
            );

            const result = await service.attemptLandingClaim(CTX, DRAFT, KEY);

            expect(result.state).toBe('account-failed');
            expect(
                accountsService.findByBusinessAndIban
            ).not.toHaveBeenCalled();
        });
    });

    // ─── Sprint 10 review fix — log-level differentiation ───

    describe('log-level routing', () => {
        let warnSpy: jest.SpyInstance;
        let errorSpy: jest.SpyInstance;

        beforeEach(() => {
            warnSpy = jest
                .spyOn(Logger.prototype, 'warn')
                .mockImplementation(() => undefined);
            errorSpy = jest
                .spyOn(Logger.prototype, 'error')
                .mockImplementation(() => undefined);
        });

        afterEach(() => {
            warnSpy.mockRestore();
            errorSpy.mockRestore();
        });

        it('POST1 + HttpException 4xx (BadRequest) → warn (user-actionable)', async () => {
            const { BadRequestException } = await import('@nestjs/common');
            businessesService.create.mockRejectedValue(
                new BadRequestException({
                    code: RESPONSE_CODE.TAX_ID_FORMAT_MISMATCH_TYPE,
                    message: 'bad tax id',
                })
            );

            await service.attemptLandingClaim(CTX, DRAFT, KEY);

            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(errorSpy).not.toHaveBeenCalled();
        });

        it('POST1 + HttpException 5xx (Internal) → error (infra)', async () => {
            businessesService.create.mockRejectedValue(
                new InternalServerErrorException({
                    code: RESPONSE_CODE.TRANSACTION_REQUIRES_REPLICA_SET,
                    message: 'replica-set required',
                })
            );

            await service.attemptLandingClaim(CTX, DRAFT, KEY);

            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('POST1 + raw Error (non-HttpException) → error (unknown infra)', async () => {
            businessesService.create.mockRejectedValue(
                new Error('Mongo connection drop')
            );

            await service.attemptLandingClaim(CTX, DRAFT, KEY);

            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('POST2 + ACCOUNT_IBAN_DUPLICATE (replay miss) → warn (4xx user-actionable)', async () => {
            businessesService.create.mockResolvedValue({
                slug: 'BizSlug1',
                _id: 'biz-id',
            });
            accountsService.create.mockRejectedValue(
                new ConflictException({
                    code: RESPONSE_CODE.ACCOUNT_IBAN_DUPLICATE,
                    message: 'IBAN already used for this business',
                })
            );
            accountsService.findByBusinessAndIban.mockResolvedValue(null);

            await service.attemptLandingClaim(CTX, DRAFT, KEY);

            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(errorSpy).not.toHaveBeenCalled();
        });

        it('POST2 + raw Error → error (unknown infra)', async () => {
            businessesService.create.mockResolvedValue({
                slug: 'BizSlug1',
                _id: 'biz-id',
            });
            accountsService.create.mockRejectedValue(
                new Error('Mongo timeout')
            );

            await service.attemptLandingClaim(CTX, DRAFT, KEY);

            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy).not.toHaveBeenCalled();
        });
    });

    // ─── Sprint 11 — pendingPostLoginTarget stamp ───

    describe('post-login target stamp', () => {
        it('success → стемпить deep-link з канонічними slug-ами', async () => {
            businessesService.create.mockResolvedValue({
                slug: 'BizSlug1',
                _id: 'biz-id',
            });
            accountsService.create.mockResolvedValue({
                slug: 'AcctSlg1',
                _id: 'acct-id',
            });

            await service.attemptLandingClaim(CTX, DRAFT, KEY);

            expect(usersService.setPendingPostLoginTarget).toHaveBeenCalledWith(
                CTX.userId,
                '/business/BizSlug1/account/AcctSlg1'
            );
        });

        it('POST2-replay (existing account знайдено) → стемпить той самий deep-link', async () => {
            businessesService.create.mockResolvedValue({
                slug: 'BizSlug1',
                _id: 'biz-id',
            });
            accountsService.create.mockRejectedValue(
                new ConflictException({
                    code: RESPONSE_CODE.ACCOUNT_IBAN_DUPLICATE,
                    message: 'IBAN already used for this business',
                })
            );
            accountsService.findByBusinessAndIban.mockResolvedValue({
                slug: 'AcctSlg1',
                _id: 'acct-id',
            });

            await service.attemptLandingClaim(CTX, DRAFT, KEY);

            expect(usersService.setPendingPostLoginTarget).toHaveBeenCalledWith(
                CTX.userId,
                '/business/BizSlug1/account/AcctSlg1'
            );
        });

        it('POST1-failure → стемп НЕ викликається', async () => {
            businessesService.create.mockRejectedValue(
                new Error('Mongo timeout')
            );

            await service.attemptLandingClaim(CTX, DRAFT, KEY);

            expect(
                usersService.setPendingPostLoginTarget
            ).not.toHaveBeenCalled();
        });

        it('POST2-failure (без replay-match) → стемп НЕ викликається', async () => {
            businessesService.create.mockResolvedValue({
                slug: 'PartialBiz',
                _id: 'biz-id',
            });
            accountsService.create.mockRejectedValue(
                new Error('IBAN duplicate')
            );

            await service.attemptLandingClaim(CTX, DRAFT, KEY);

            expect(
                usersService.setPendingPostLoginTarget
            ).not.toHaveBeenCalled();
        });

        it('stamp infra-failure (Mongo timeout) — non-blocking: success + warn', async () => {
            const warnSpy = jest
                .spyOn(Logger.prototype, 'warn')
                .mockImplementation(() => undefined);
            const errorSpy = jest
                .spyOn(Logger.prototype, 'error')
                .mockImplementation(() => undefined);
            try {
                businessesService.create.mockResolvedValue({
                    slug: 'BizSlug1',
                    _id: 'biz-id',
                });
                accountsService.create.mockResolvedValue({
                    slug: 'AcctSlg1',
                    _id: 'acct-id',
                });
                usersService.setPendingPostLoginTarget.mockRejectedValue(
                    new Error('Mongo timeout')
                );

                const result = await service.attemptLandingClaim(
                    CTX,
                    DRAFT,
                    KEY
                );

                expect(result).toEqual({
                    state: 'success',
                    claimedBusinessSlug: 'BizSlug1',
                    claimedAccountSlug: 'AcctSlg1',
                });
                expect(warnSpy).toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
            } finally {
                warnSpy.mockRestore();
                errorSpy.mockRestore();
            }
        });

        it('stamp INVALID_REDIRECT_TARGET (programmer bug) — non-blocking: success + logger.error (alertable)', async () => {
            const warnSpy = jest
                .spyOn(Logger.prototype, 'warn')
                .mockImplementation(() => undefined);
            const errorSpy = jest
                .spyOn(Logger.prototype, 'error')
                .mockImplementation(() => undefined);
            try {
                const { BadRequestException } = await import('@nestjs/common');
                businessesService.create.mockResolvedValue({
                    slug: 'BizSlug1',
                    _id: 'biz-id',
                });
                accountsService.create.mockResolvedValue({
                    slug: 'AcctSlg1',
                    _id: 'acct-id',
                });
                usersService.setPendingPostLoginTarget.mockRejectedValue(
                    new BadRequestException({
                        code: RESPONSE_CODE.INVALID_REDIRECT_TARGET,
                        message: 'Invalid pending post-login target',
                    })
                );

                const result = await service.attemptLandingClaim(
                    CTX,
                    DRAFT,
                    KEY
                );

                expect(result).toEqual({
                    state: 'success',
                    claimedBusinessSlug: 'BizSlug1',
                    claimedAccountSlug: 'AcctSlg1',
                });
                expect(errorSpy).toHaveBeenCalled();
                expect(warnSpy).not.toHaveBeenCalled();
            } finally {
                warnSpy.mockRestore();
                errorSpy.mockRestore();
            }
        });
    });
});
