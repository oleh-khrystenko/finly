import {
    BadRequestException,
    ConflictException,
    UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MAGIC_LINK_PURPOSE, RESPONSE_CODE } from '@finly/types';

import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
import { AccountDeletionController } from './account-deletion.controller';
import { AccountDeletionService } from './account-deletion.service';

const USER_ID = '507f1f77bcf86cd799439011';

const mockUser = {
    _id: { toString: () => USER_ID },
    email: 'test@gmail.com',
    passwordHash: '$2b$10$hash',
    deletedAt: null as Date | null,
};

const mockUsersService = {
    softDelete: jest.fn(),
    restore: jest.fn(),
    setDeletionRequested: jest.fn(),
};

const mockAuthService = {
    sendMagicLink: jest.fn(),
    verifyPassword: jest.fn(),
    revokeAllUserTokens: jest.fn(),
    sendDeletionConfirmationEmail: jest.fn(),
};

const mockAccountDeletion = {
    getPreview: jest.fn(),
    applyDeactivationEffectsBestEffort: jest.fn().mockResolvedValue(undefined),
    revertDeactivationEffects: jest.fn().mockResolvedValue(undefined),
};

describe('AccountDeletionController', () => {
    let controller: AccountDeletionController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [AccountDeletionController],
            providers: [
                { provide: UsersService, useValue: mockUsersService },
                { provide: AuthService, useValue: mockAuthService },
                {
                    provide: AccountDeletionService,
                    useValue: mockAccountDeletion,
                },
            ],
        }).compile();

        controller = module.get(AccountDeletionController);
        jest.clearAllMocks();
    });

    describe('GET /users/account/delete/preview', () => {
        it('віддає перелік і шлях підтвердження паролем, коли пароль є', async () => {
            const preview = {
                confirmMethod: 'password',
                owned: [],
                managed: [],
                totals: {
                    businessesCount: 0,
                    accountsCount: 0,
                    invoicesCount: 0,
                },
            };
            mockAccountDeletion.getPreview.mockResolvedValue(preview);

            const result = await controller.getDeletionPreview(mockUser as any);

            expect(mockAccountDeletion.getPreview).toHaveBeenCalledWith(
                USER_ID,
                'password'
            );
            expect(result).toEqual({ data: preview });
        });

        it('віддає шлях підтвердження листом, коли пароля немає', async () => {
            mockAccountDeletion.getPreview.mockResolvedValue({});

            await controller.getDeletionPreview({
                ...mockUser,
                passwordHash: null,
            } as any);

            expect(mockAccountDeletion.getPreview).toHaveBeenCalledWith(
                USER_ID,
                'email'
            );
        });
    });

    describe('POST /users/account/delete', () => {
        it('повертає requiresPassword, коли пароль є', async () => {
            const result = await controller.deleteAccount(mockUser as any);

            expect(result).toEqual({ data: { requiresPassword: true } });
            expect(mockAuthService.sendMagicLink).not.toHaveBeenCalled();
        });

        it('шле разове посилання, коли пароля немає', async () => {
            mockAuthService.sendMagicLink.mockResolvedValue(undefined);
            mockUsersService.setDeletionRequested.mockResolvedValue(undefined);

            const result = await controller.deleteAccount({
                ...mockUser,
                passwordHash: null,
            } as any);

            expect(mockAuthService.sendMagicLink).toHaveBeenCalledWith(
                'test@gmail.com',
                MAGIC_LINK_PURPOSE.DELETE_ACCOUNT
            );
            expect(mockUsersService.setDeletionRequested).toHaveBeenCalledWith(
                USER_ID
            );
            expect(result).toEqual({
                data: {
                    requiresMagicLink: true,
                    message: 'Confirmation link sent',
                },
            });
        });

        it('саме натискання кнопки не гасить публічність і не ставить паузу', async () => {
            await controller.deleteAccount({
                ...mockUser,
                passwordHash: null,
            } as any);

            expect(
                mockAccountDeletion.applyDeactivationEffectsBestEffort
            ).not.toHaveBeenCalled();
        });
    });

    describe('POST /users/account/delete/confirm', () => {
        it('деактивує, гасить публічність, ставить паузу і відкликає сесії', async () => {
            mockAuthService.verifyPassword.mockResolvedValue(true);
            const res = { clearCookie: jest.fn() };

            const result = await controller.confirmDeleteAccount(
                mockUser as any,
                { password: 'correct' } as any,
                res as any
            );

            expect(mockUsersService.softDelete).toHaveBeenCalledWith(USER_ID);
            expect(
                mockAccountDeletion.applyDeactivationEffectsBestEffort
            ).toHaveBeenCalledWith(USER_ID);
            expect(mockAuthService.revokeAllUserTokens).toHaveBeenCalledWith(
                USER_ID
            );
            expect(
                mockAuthService.sendDeletionConfirmationEmail
            ).toHaveBeenCalledWith('test@gmail.com');
            expect(res.clearCookie).toHaveBeenCalledWith(
                'bid_refresh',
                expect.objectContaining({ path: '/' })
            );
            expect(result).toEqual({
                data: {
                    code: RESPONSE_CODE.ACCOUNT_DELETED,
                    message: 'Account scheduled for deletion',
                },
            });
        });

        it('невірний пароль не змінює нічого', async () => {
            mockAuthService.verifyPassword.mockResolvedValue(false);

            await expect(
                controller.confirmDeleteAccount(
                    mockUser as any,
                    { password: 'wrong' } as any,
                    {} as any
                )
            ).rejects.toThrow(UnauthorizedException);

            expect(mockUsersService.softDelete).not.toHaveBeenCalled();
            expect(
                mockAccountDeletion.applyDeactivationEffectsBestEffort
            ).not.toHaveBeenCalled();
        });
    });

    describe('POST /users/account/restore', () => {
        beforeEach(() => {
            mockUsersService.restore.mockResolvedValue(true);
        });

        it('повертає акаунт разом з публічністю і знімає паузу списань', async () => {
            const result = await controller.restoreAccount({
                ...mockUser,
                deletedAt: new Date('2026-01-01'),
            } as any);

            expect(mockUsersService.restore).toHaveBeenCalledWith(USER_ID);
            expect(
                mockAccountDeletion.revertDeactivationEffects
            ).toHaveBeenCalledWith(USER_ID);
            expect(result).toEqual({
                data: {
                    code: RESPONSE_CODE.ACCOUNT_RESTORED,
                    message: 'Account restored',
                },
            });
        });

        it('на живому акаунті — 400 і жодних ефектів', async () => {
            await expect(
                controller.restoreAccount(mockUser as any)
            ).rejects.toThrow(BadRequestException);

            expect(mockUsersService.restore).not.toHaveBeenCalled();
            expect(
                mockAccountDeletion.revertDeactivationEffects
            ).not.toHaveBeenCalled();
        });

        // Прибирання встигло взятись за акаунт: отримувачі вже знесені, тож
        // знімати деактивацію означало б повернути людину у порожній кабінет.
        it('коли прибирання вже почалось — 409 і жодного зняття позначок', async () => {
            mockUsersService.restore.mockResolvedValue(false);

            await expect(
                controller.restoreAccount({
                    ...mockUser,
                    deletedAt: new Date('2026-01-01'),
                } as any)
            ).rejects.toThrow(ConflictException);

            expect(
                mockAccountDeletion.revertDeactivationEffects
            ).not.toHaveBeenCalled();
        });
    });
});
