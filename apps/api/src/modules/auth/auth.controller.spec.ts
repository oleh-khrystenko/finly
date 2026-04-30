import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RESPONSE_CODE, MAGIC_LINK_PURPOSE } from '@neatslip/types';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

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
    handleGoogleAuth: jest.fn(),
    checkEmail: jest.fn(),
    loginWithPassword: jest.fn(),
    sendMagicLink: jest.fn(),
    verifyMagicLink: jest.fn(),
    setPassword: jest.fn(),
    changePassword: jest.fn(),
    verifyPassword: jest.fn(),
    rotateRefreshToken: jest.fn(),
    revokeRefreshTokenByJwt: jest.fn(),
};

const createMockResponse = () => ({
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    redirect: jest.fn(),
});

const createMockRequest = (overrides = {}) => ({
    ip: '192.168.1.1',
    socket: { remoteAddress: '192.168.1.1' },
    cookies: {},
    user: mockUser,
    ...overrides,
});

describe('AuthController', () => {
    let controller: AuthController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [AuthController],
            providers: [{ provide: AuthService, useValue: mockAuthService }],
        }).compile();

        controller = module.get<AuthController>(AuthController);
        jest.clearAllMocks();
    });

    describe('POST /auth/check-email', () => {
        it('should return hasPassword and isNewUser', async () => {
            mockAuthService.checkEmail.mockResolvedValue({
                hasPassword: true,
                isNewUser: false,
            });
            const req = createMockRequest();

            const result = await controller.checkEmail(
                { email: 'test@gmail.com' } as any,
                req as any
            );

            expect(result).toEqual({
                data: { hasPassword: true, isNewUser: false },
            });
            expect(mockAuthService.checkEmail).toHaveBeenCalledWith(
                'test@gmail.com',
                '192.168.1.1'
            );
        });

        it('should fallback to socket.remoteAddress when ip is undefined', async () => {
            mockAuthService.checkEmail.mockResolvedValue({
                hasPassword: false,
                isNewUser: true,
            });
            const req = createMockRequest({
                ip: undefined,
                socket: { remoteAddress: '10.0.0.1' },
            });

            await controller.checkEmail(
                { email: 'new@gmail.com' } as any,
                req as any
            );

            expect(mockAuthService.checkEmail).toHaveBeenCalledWith(
                'new@gmail.com',
                '10.0.0.1'
            );
        });
    });

    describe('POST /auth/login/password', () => {
        it('should set bid_refresh cookie and return user + accessToken', async () => {
            mockAuthService.loginWithPassword.mockResolvedValue({
                user: mockUser,
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
            });
            const req = createMockRequest();
            const res = createMockResponse();

            const result = await controller.loginWithPassword(
                { email: 'test@gmail.com', password: 'pass123' } as any,
                req as any,
                res as any
            );

            expect(res.cookie).toHaveBeenCalledWith(
                'bid_refresh',
                'refresh-token',
                expect.objectContaining({
                    httpOnly: true,
                    path: '/',
                    sameSite: 'lax',
                })
            );
            expect(result.data.accessToken).toBe('access-token');
            expect(result.data.user.email).toBe('test@gmail.com');
        });

        it('should include accountDeleted when user is deleted', async () => {
            mockAuthService.loginWithPassword.mockResolvedValue({
                user: { ...mockUser, deletedAt: new Date() },
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
                accountDeleted: true,
            });
            const req = createMockRequest();
            const res = createMockResponse();

            const result = await controller.loginWithPassword(
                { email: 'test@gmail.com', password: 'pass123' } as any,
                req as any,
                res as any
            );

            expect(result.data.accountDeleted).toBe(true);
        });

        it('should pass IP to authService', async () => {
            mockAuthService.loginWithPassword.mockResolvedValue({
                user: mockUser,
                accessToken: 'at',
                refreshToken: 'rt',
            });
            const req = createMockRequest({ ip: '1.2.3.4' });
            const res = createMockResponse();

            await controller.loginWithPassword(
                { email: 'test@gmail.com', password: 'pass' } as any,
                req as any,
                res as any
            );

            expect(mockAuthService.loginWithPassword).toHaveBeenCalledWith(
                'test@gmail.com',
                'pass',
                '1.2.3.4',
                undefined
            );
        });
    });

    describe('POST /auth/magic-link/send', () => {
        it('should return MAGIC_LINK_SENT response code', async () => {
            mockAuthService.sendMagicLink.mockResolvedValue(undefined);

            const result = await controller.sendMagicLink({
                email: 'test@gmail.com',
            } as any);

            expect(result).toEqual({
                data: {
                    code: RESPONSE_CODE.MAGIC_LINK_SENT,
                    message: 'Magic link sent',
                },
            });
        });

        it('should default purpose to LOGIN', async () => {
            mockAuthService.sendMagicLink.mockResolvedValue(undefined);

            await controller.sendMagicLink({
                email: 'test@gmail.com',
                purpose: undefined,
            } as any);

            expect(mockAuthService.sendMagicLink).toHaveBeenCalledWith(
                'test@gmail.com',
                MAGIC_LINK_PURPOSE.LOGIN,
                undefined
            );
        });

        it('should pass provided purpose', async () => {
            mockAuthService.sendMagicLink.mockResolvedValue(undefined);

            await controller.sendMagicLink({
                email: 'test@gmail.com',
                purpose: MAGIC_LINK_PURPOSE.REGISTER,
            } as any);

            expect(mockAuthService.sendMagicLink).toHaveBeenCalledWith(
                'test@gmail.com',
                MAGIC_LINK_PURPOSE.REGISTER,
                undefined
            );
        });
    });

    describe('POST /auth/magic-link/verify', () => {
        it('should set cookie and return user for login purpose', async () => {
            mockAuthService.verifyMagicLink.mockResolvedValue({
                user: mockUser,
                tokens: {
                    accessToken: 'access-token',
                    refreshToken: 'refresh-token',
                },
                purpose: 'login',
                deleted: false,
            });
            const res = createMockResponse();

            const result = await controller.verifyMagicLink(
                { token: 'abc123' } as any,
                res as any
            );

            expect(res.cookie).toHaveBeenCalledWith(
                'bid_refresh',
                'refresh-token',
                expect.objectContaining({ httpOnly: true })
            );
            expect(result.data).toHaveProperty('accessToken', 'access-token');
        });

        it('should clear cookie and return deleted response for delete-account', async () => {
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
            expect(result.data).toEqual({
                deleted: true,
                purpose: MAGIC_LINK_PURPOSE.DELETE_ACCOUNT,
                message: 'Account scheduled for deletion',
            });
        });

        it('should include purpose in response', async () => {
            mockAuthService.verifyMagicLink.mockResolvedValue({
                user: mockUser,
                tokens: {
                    accessToken: 'at',
                    refreshToken: 'rt',
                },
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

    describe('GET /auth/google/callback', () => {
        it('should redirect to WEB_URL/auth/callback', async () => {
            mockAuthService.handleGoogleAuth.mockResolvedValue({
                user: mockUser,
                tokens: {
                    accessToken: 'at',
                    refreshToken: 'rt',
                },
            });
            const req = createMockRequest();
            const res = createMockResponse();

            await controller.googleCallback(req as any, res as any);

            expect(res.cookie).toHaveBeenCalledWith(
                'bid_refresh',
                'rt',
                expect.objectContaining({ httpOnly: true })
            );
            expect(res.redirect).toHaveBeenCalledWith(
                'http://localhost:3000/auth/callback'
            );
        });

        it('should add account_deleted query param for deleted user', async () => {
            mockAuthService.handleGoogleAuth.mockResolvedValue({
                user: mockUser,
                tokens: {
                    accessToken: 'at',
                    refreshToken: 'rt',
                },
                accountDeleted: true,
            });
            const req = createMockRequest();
            const res = createMockResponse();

            await controller.googleCallback(req as any, res as any);

            expect(res.redirect).toHaveBeenCalledWith(
                'http://localhost:3000/auth/callback?account_deleted=true'
            );
        });
    });

    describe('POST /auth/password/set', () => {
        it('should return PASSWORD_SET response code', async () => {
            mockAuthService.setPassword.mockResolvedValue(undefined);

            const result = await controller.setPassword(
                mockUser as any,
                { password: 'newPass123' } as any
            );

            expect(result).toEqual({
                data: {
                    code: RESPONSE_CODE.PASSWORD_SET,
                    message: 'Password set',
                },
            });
            expect(mockAuthService.setPassword).toHaveBeenCalledWith(
                '507f1f77bcf86cd799439011',
                'newPass123'
            );
        });
    });

    describe('POST /auth/password/change', () => {
        it('should set new cookie and return accessToken', async () => {
            mockAuthService.changePassword.mockResolvedValue({
                accessToken: 'new-access',
                refreshToken: 'new-refresh',
            });
            const res = createMockResponse();

            const result = await controller.changePassword(
                mockUser as any,
                {
                    currentPassword: 'oldPass',
                    newPassword: 'newPass',
                } as any,
                res as any
            );

            expect(res.cookie).toHaveBeenCalledWith(
                'bid_refresh',
                'new-refresh',
                expect.objectContaining({ httpOnly: true })
            );
            expect(result.data.accessToken).toBe('new-access');
        });
    });

    describe('POST /auth/password/verify', () => {
        it('should return isValid: true for valid password', async () => {
            mockAuthService.verifyPassword.mockResolvedValue(true);

            const result = await controller.verifyPassword(
                mockUser as any,
                { password: 'correct' } as any
            );

            expect(result).toEqual({ data: { isValid: true } });
        });

        it('should return isValid: false for invalid password', async () => {
            mockAuthService.verifyPassword.mockResolvedValue(false);

            const result = await controller.verifyPassword(
                mockUser as any,
                { password: 'wrong' } as any
            );

            expect(result).toEqual({ data: { isValid: false } });
        });
    });

    describe('POST /auth/refresh', () => {
        it('should rotate token, set new cookie, return accessToken', async () => {
            mockAuthService.rotateRefreshToken.mockResolvedValue({
                accessToken: 'new-access',
                refreshToken: 'new-refresh',
            });
            const req = createMockRequest({
                cookies: { bid_refresh: 'old-refresh' },
            });
            const res = createMockResponse();

            const result = await controller.refresh(
                {} as any,
                req as any,
                res as any
            );

            expect(mockAuthService.rotateRefreshToken).toHaveBeenCalledWith(
                'old-refresh',
                undefined
            );
            expect(res.cookie).toHaveBeenCalledWith(
                'bid_refresh',
                'new-refresh',
                expect.objectContaining({ httpOnly: true })
            );
            expect(result).toEqual({
                data: { accessToken: 'new-access' },
            });
        });

        it('should throw 401 when no refresh cookie', async () => {
            const req = createMockRequest({ cookies: {} });
            const res = createMockResponse();

            await expect(
                controller.refresh({} as any, req as any, res as any)
            ).rejects.toThrow(UnauthorizedException);
        });

        it('should clear cookie on rotation error', async () => {
            mockAuthService.rotateRefreshToken.mockRejectedValue(
                new UnauthorizedException('Reuse detected')
            );
            const req = createMockRequest({
                cookies: { bid_refresh: 'bad-token' },
            });
            const res = createMockResponse();

            await expect(
                controller.refresh({} as any, req as any, res as any)
            ).rejects.toThrow(UnauthorizedException);

            expect(res.clearCookie).toHaveBeenCalledWith(
                'bid_refresh',
                expect.objectContaining({ httpOnly: true, path: '/' })
            );
        });
    });

    describe('POST /auth/logout', () => {
        it('should revoke token and clear cookie', async () => {
            mockAuthService.revokeRefreshTokenByJwt.mockResolvedValue(
                undefined
            );
            const req = createMockRequest({
                cookies: { bid_refresh: 'some-token' },
            });
            const res = createMockResponse();

            const result = await controller.logout(req as any, res as any);

            expect(
                mockAuthService.revokeRefreshTokenByJwt
            ).toHaveBeenCalledWith('some-token');
            expect(res.clearCookie).toHaveBeenCalledWith(
                'bid_refresh',
                expect.objectContaining({ httpOnly: true, path: '/' })
            );
            expect(result).toEqual({
                data: {
                    code: RESPONSE_CODE.LOGGED_OUT,
                    message: 'Logged out',
                },
            });
        });

        it('should not revoke when no cookie present', async () => {
            const req = createMockRequest({ cookies: {} });
            const res = createMockResponse();

            await controller.logout(req as any, res as any);

            expect(
                mockAuthService.revokeRefreshTokenByJwt
            ).not.toHaveBeenCalled();
            expect(res.clearCookie).toHaveBeenCalled();
        });
    });
});
