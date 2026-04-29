import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RESPONSE_CODE, MAGIC_LINK_PURPOSE } from '@neatslip/types';

import { AuthService } from '../auth/auth.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const mockUser = {
    id: '507f1f77bcf86cd799439011',
    _id: { toString: () => '507f1f77bcf86cd799439011' },
    email: 'test@gmail.com',
    profile: { firstName: 'John', lastName: 'Doe', avatar: null },
    executions: { balance: 5, freeReportUsed: false },
    passwordHash: '$2b$10$hash',
    deletedAt: null as Date | null,
    accountDeletionRequestedAt: null as Date | null,
    preferredLang: 'en',
};

const mockUsersService = {
    updateProfile: jest.fn(),
    updateLang: jest.fn(),
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

describe('UsersController', () => {
    let controller: UsersController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [UsersController],
            providers: [
                { provide: UsersService, useValue: mockUsersService },
                { provide: AuthService, useValue: mockAuthService },
            ],
        }).compile();

        controller = module.get<UsersController>(UsersController);
        jest.clearAllMocks();
    });

    describe('GET /users/me', () => {
        it('should return user data in correct format', () => {
            const result = controller.getMe(mockUser as any);

            expect(result).toEqual({
                data: {
                    id: '507f1f77bcf86cd799439011',
                    email: 'test@gmail.com',
                    profile: {
                        firstName: 'John',
                        lastName: 'Doe',
                        avatar: null,
                    },
                    executions: { balance: 5, freeReportUsed: false },
                    hasPassword: true,
                    deletedAt: null,
                    accountDeletionRequestedAt: null,
                    preferredLang: 'en',
                    termsVersion: null,
                    billing: null,
                    ai: null,
                },
            });
        });

        it('should return hasPassword: false when no passwordHash', () => {
            const userNoPass = { ...mockUser, passwordHash: null };
            const result = controller.getMe(userNoPass as any);

            expect(result.data.hasPassword).toBe(false);
        });

        it('should return deletedAt when user is soft-deleted', () => {
            const deletedDate = new Date('2026-01-01');
            const deletedUser = {
                ...mockUser,
                deletedAt: deletedDate,
            };
            const result = controller.getMe(deletedUser as any);

            expect(result.data.deletedAt).toBe(deletedDate);
        });
    });

    describe('PATCH /users/me', () => {
        it('should call updateProfile and return updated user', async () => {
            const updated = {
                ...mockUser,
                _id: '507f1f77bcf86cd799439011',
                profile: {
                    firstName: 'New',
                    lastName: 'Name',
                    avatar: 'https://new.url',
                },
            };
            mockUsersService.updateProfile.mockResolvedValue(updated);

            const result = await controller.updateProfile(
                mockUser as any,
                {
                    firstName: 'New',
                    lastName: 'Name',
                    avatar: 'https://new.url',
                } as any
            );

            expect(mockUsersService.updateProfile).toHaveBeenCalledWith(
                '507f1f77bcf86cd799439011',
                {
                    firstName: 'New',
                    lastName: 'Name',
                    avatar: 'https://new.url',
                }
            );
            expect(result.data.profile).toEqual({
                firstName: 'New',
                lastName: 'Name',
                avatar: 'https://new.url',
            });
        });
    });

    describe('PATCH /users/me/lang', () => {
        it('should call updateLang and return LANG_UPDATED', async () => {
            mockUsersService.updateLang.mockResolvedValue(undefined);

            const result = await controller.updateLang(
                mockUser as any,
                {
                    lang: 'en',
                } as any
            );

            expect(mockUsersService.updateLang).toHaveBeenCalledWith(
                '507f1f77bcf86cd799439011',
                'en'
            );
            expect(result).toEqual({
                data: {
                    code: RESPONSE_CODE.LANG_UPDATED,
                    message: 'Language updated',
                },
            });
        });
    });

    describe('POST /users/account/delete', () => {
        it('should return requiresPassword: true when user has password', async () => {
            const result = await controller.deleteAccount(mockUser as any);

            expect(result).toEqual({
                data: { requiresPassword: true },
            });
            expect(mockAuthService.sendMagicLink).not.toHaveBeenCalled();
        });

        it('should send magic link and return requiresMagicLink: true when no password', async () => {
            const userNoPass = { ...mockUser, passwordHash: null };
            mockAuthService.sendMagicLink.mockResolvedValue(undefined);
            mockUsersService.setDeletionRequested.mockResolvedValue(undefined);

            const result = await controller.deleteAccount(userNoPass as any);

            expect(mockAuthService.sendMagicLink).toHaveBeenCalledWith(
                'test@gmail.com',
                MAGIC_LINK_PURPOSE.DELETE_ACCOUNT
            );
            expect(mockUsersService.setDeletionRequested).toHaveBeenCalledWith(
                '507f1f77bcf86cd799439011'
            );
            expect(result).toEqual({
                data: {
                    requiresMagicLink: true,
                    message: 'Confirmation link sent',
                },
            });
        });
    });

    describe('POST /users/account/delete/confirm', () => {
        it('should soft-delete, revoke tokens, send email, clear cookie', async () => {
            mockAuthService.verifyPassword.mockResolvedValue(true);
            mockUsersService.softDelete.mockResolvedValue(undefined);
            mockAuthService.revokeAllUserTokens.mockResolvedValue(undefined);
            mockAuthService.sendDeletionConfirmationEmail.mockResolvedValue(
                undefined
            );
            const res = { clearCookie: jest.fn() };

            const result = await controller.confirmDeleteAccount(
                mockUser as any,
                { password: 'correct' } as any,
                res as any
            );

            expect(mockAuthService.verifyPassword).toHaveBeenCalledWith(
                '507f1f77bcf86cd799439011',
                'correct'
            );
            expect(mockUsersService.softDelete).toHaveBeenCalledWith(
                '507f1f77bcf86cd799439011'
            );
            expect(mockAuthService.revokeAllUserTokens).toHaveBeenCalledWith(
                '507f1f77bcf86cd799439011'
            );
            expect(
                mockAuthService.sendDeletionConfirmationEmail
            ).toHaveBeenCalledWith('test@gmail.com', 'en');
            expect(res.clearCookie).toHaveBeenCalledWith('bid_refresh', {
                path: '/',
            });
            expect(result).toEqual({
                data: {
                    code: RESPONSE_CODE.ACCOUNT_DELETED,
                    message: 'Account scheduled for deletion',
                },
            });
        });

        it('should throw 401 on invalid password', async () => {
            mockAuthService.verifyPassword.mockResolvedValue(false);

            await expect(
                controller.confirmDeleteAccount(
                    mockUser as any,
                    { password: 'wrong' } as any,
                    {} as any
                )
            ).rejects.toThrow(UnauthorizedException);

            expect(mockUsersService.softDelete).not.toHaveBeenCalled();
        });
    });

    describe('POST /users/account/restore', () => {
        it('should restore deleted user and return ACCOUNT_RESTORED', async () => {
            const deletedUser = {
                ...mockUser,
                deletedAt: new Date('2026-01-01'),
            };
            mockUsersService.restore.mockResolvedValue(undefined);

            const result = await controller.restoreAccount(deletedUser as any);

            expect(mockUsersService.restore).toHaveBeenCalledWith(
                '507f1f77bcf86cd799439011'
            );
            expect(result).toEqual({
                data: {
                    code: RESPONSE_CODE.ACCOUNT_RESTORED,
                    message: 'Account restored',
                },
            });
        });

        it('should throw 400 when account is not deleted', async () => {
            await expect(
                controller.restoreAccount(mockUser as any)
            ).rejects.toThrow(BadRequestException);

            expect(mockUsersService.restore).not.toHaveBeenCalled();
        });
    });
});
