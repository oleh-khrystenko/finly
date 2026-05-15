import {
    BadRequestException,
    HttpStatus,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';

import { REDIS_CLIENT } from '../../common/modules/redis.module';
import { RedisCounterService } from '../../common/services/redis-counter.service';
import { AvatarService } from '../users/avatar.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { EmailService } from '../email/email.service';

jest.mock('../../config/env', () => ({
    ENV: {
        JWT_ACCESS_SECRET: 'test-access-secret',
        JWT_REFRESH_SECRET: 'test-refresh-secret',
        WEB_URL: 'http://localhost:3000',
        RESEND_API_KEY: 'test-resend-key',
        AUTH_LOCKOUT_THRESHOLDS: '5:1,10:5,20:15',
        AUTH_LOGIN_ATTEMPTS_TTL_MIN: 15,
        AUTH_MAGIC_LINK_TTL_MIN: 15,
        AUTH_MAGIC_LINK_RATE_LIMIT: 3,
        AUTH_MAGIC_LINK_RATE_WINDOW_MIN: 15,
        AUTH_MAGIC_LINK_DEDUP_SEC: 60,
        ACCOUNT_DELETION_GRACE_DAYS: 30,
    },
    parseLockoutThresholds: (raw: string) =>
        raw.split(',').map((entry: string) => {
            const [attempts, blockMin] = entry.split(':').map(Number);
            return { attempts, blockMin };
        }),
}));

jest.mock('bcrypt', () => ({
    compare: jest.fn(),
    hash: jest.fn().mockResolvedValue('$2b$10$newhash'),
}));

import * as bcrypt from 'bcrypt';

const mockUser = {
    id: '507f1f77bcf86cd799439011',
    _id: { toString: () => '507f1f77bcf86cd799439011' },
    email: 'test@gmail.com',
    profile: { name: 'John Doe' },
    executions: { balance: 0, freeReportUsed: false },
    passwordHash: null as string | null,
    lastLoginAt: null as Date | null,
    save: jest.fn().mockImplementation(function (this: unknown) {
        return Promise.resolve(this);
    }),
};

// Pipeline is now used only by refresh-token rotation flow:
//   set/sadd/expire — storeRefreshToken (set token, add to family, refresh family TTL)
//   del/srem        — revokeRefreshToken (delete token, remove from family)
// INCR-based rate-limit usage moved to RedisCounterService.
const mockPipeline = {
    set: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
    del: jest.fn().mockReturnThis(),
    sadd: jest.fn().mockReturnThis(),
    srem: jest.fn().mockReturnThis(),
};

const mockRedis = {
    get: jest.fn(),
    getdel: jest.fn(),
    del: jest.fn(),
    set: jest.fn(),
    srem: jest.fn(),
    pipeline: jest.fn(),
    smembers: jest.fn(),
};

const mockRedisCounter = {
    incrementFixedWindow: jest.fn(),
    incrementSlidingWindow: jest.fn(),
};

const mockAvatarService = {
    syncExternalAvatar: jest.fn(),
};

describe('AuthService', () => {
    let authService: AuthService;
    let jwtService: JwtService;
    let usersService: UsersService;
    let emailService: EmailService;

    beforeEach(async () => {
        mockRedis.pipeline.mockReturnValue(mockPipeline);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthService,
                {
                    provide: JwtService,
                    useValue: {
                        signAsync: jest.fn(),
                        verifyAsync: jest.fn(),
                    },
                },
                {
                    provide: UsersService,
                    useValue: {
                        findByEmail: jest.fn(),
                        findById: jest.fn(),
                        findOrCreateByGoogle: jest.fn(),
                        findOrCreateByEmail: jest.fn(),
                        setPasswordHash: jest.fn().mockResolvedValue(undefined),
                        softDelete: jest.fn().mockResolvedValue(undefined),
                        updateTimezone: jest.fn().mockResolvedValue(undefined),
                        acceptTerms: jest.fn().mockResolvedValue(undefined),
                    },
                },
                {
                    provide: EmailService,
                    useValue: {
                        sendMagicLink: jest.fn().mockResolvedValue(undefined),
                        sendDeletionConfirmation: jest
                            .fn()
                            .mockResolvedValue(undefined),
                    },
                },
                {
                    provide: AvatarService,
                    useValue: mockAvatarService,
                },
                {
                    provide: REDIS_CLIENT,
                    useValue: mockRedis,
                },
                {
                    provide: RedisCounterService,
                    useValue: mockRedisCounter,
                },
            ],
        }).compile();

        authService = module.get<AuthService>(AuthService);
        jwtService = module.get<JwtService>(JwtService);
        usersService = module.get<UsersService>(UsersService);
        emailService = module.get<EmailService>(EmailService);
        jest.clearAllMocks();
        mockRedis.pipeline.mockReturnValue(mockPipeline);
        // Default: counter calls return 1 (first hit, well under any limit)
        mockRedisCounter.incrementFixedWindow.mockResolvedValue(1);
        mockRedisCounter.incrementSlidingWindow.mockResolvedValue(1);
        // Default: no avatar re-upload path. Individual tests override.
        mockAvatarService.syncExternalAvatar.mockReset();
    });

    describe('generateTokens', () => {
        it('should generate tokens and store refresh token in Redis', async () => {
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('access-token')
                .mockResolvedValueOnce('refresh-token');

            const result = await authService.generateTokens(
                'user-id',
                'test@gmail.com'
            );

            expect(result).toEqual({
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
            });
            expect(jwtService.signAsync).toHaveBeenCalledTimes(2);

            // Access token payload should NOT have jti
            expect(jwtService.signAsync).toHaveBeenCalledWith(
                { sub: 'user-id', email: 'test@gmail.com' },
                expect.objectContaining({ expiresIn: '1h' })
            );

            // Refresh token payload should have jti
            expect(jwtService.signAsync).toHaveBeenCalledWith(
                {
                    sub: 'user-id',
                    email: 'test@gmail.com',
                    jti: expect.any(String),
                },
                expect.objectContaining({ expiresIn: '7d' })
            );

            // Verify Redis storage via pipeline
            expect(mockPipeline.set).toHaveBeenCalledWith(
                expect.stringMatching(/^refresh:[0-9a-f-]{36}$/),
                'user-id',
                'EX',
                604800
            );
            expect(mockPipeline.sadd).toHaveBeenCalledWith(
                'refresh_family:user-id',
                expect.any(String)
            );
            expect(mockPipeline.exec).toHaveBeenCalled();
        });
    });

    describe('rotateRefreshToken', () => {
        const validPayload = {
            sub: '507f1f77bcf86cd799439011',
            email: 'test@gmail.com',
            jti: 'old-jti-uuid',
        };

        it('should rotate token: atomically consume old, issue new pair', async () => {
            jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue(
                validPayload
            );
            mockRedis.getdel.mockResolvedValue(validPayload.sub);
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('new-access-token')
                .mockResolvedValueOnce('new-refresh-token');

            const result =
                await authService.rotateRefreshToken('old-refresh-jwt');

            expect(result).toEqual({
                accessToken: 'new-access-token',
                refreshToken: 'new-refresh-token',
            });
            expect(mockRedis.getdel).toHaveBeenCalledWith(
                'refresh:old-jti-uuid'
            );
            // Old token marked as rotated with grace period
            expect(mockRedis.set).toHaveBeenCalledWith(
                'refresh:old-jti-uuid',
                'rotated',
                'EX',
                10
            );
            expect(mockRedis.srem).toHaveBeenCalledWith(
                `refresh_family:${validPayload.sub}`,
                'old-jti-uuid'
            );
        });

        it('should throw on invalid JWT signature', async () => {
            jest.spyOn(jwtService, 'verifyAsync').mockRejectedValue(
                new Error('bad sig')
            );

            await expect(
                authService.rotateRefreshToken('bad-token')
            ).rejects.toThrow(UnauthorizedException);
        });

        it('should throw on missing jti (legacy token)', async () => {
            jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
                sub: 'user-id',
                email: 'test@gmail.com',
            });

            await expect(
                authService.rotateRefreshToken('legacy-token')
            ).rejects.toThrow(UnauthorizedException);
        });

        it('should revoke ALL user tokens on reuse detection', async () => {
            jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue(
                validPayload
            );
            // jti NOT found in Redis — already consumed
            mockRedis.getdel.mockResolvedValue(null);
            mockRedis.smembers.mockResolvedValue(['jti-1', 'jti-2']);

            await expect(
                authService.rotateRefreshToken('reused-token')
            ).rejects.toThrow('Refresh token reuse detected');

            expect(mockRedis.smembers).toHaveBeenCalledWith(
                `refresh_family:${validPayload.sub}`
            );
            expect(mockPipeline.del).toHaveBeenCalledWith('refresh:jti-1');
            expect(mockPipeline.del).toHaveBeenCalledWith('refresh:jti-2');
            expect(mockPipeline.del).toHaveBeenCalledWith(
                `refresh_family:${validPayload.sub}`
            );
        });

        it('should throw on userId mismatch between JWT and Redis', async () => {
            jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue(
                validPayload
            );
            mockRedis.getdel.mockResolvedValue('different-user-id');

            await expect(
                authService.rotateRefreshToken('token')
            ).rejects.toThrow('Token user mismatch');
        });

        it('should allow one concurrent refresh within grace period', async () => {
            jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue(
                validPayload
            );
            mockRedis.getdel.mockResolvedValue('rotated');
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('new-access')
                .mockResolvedValueOnce('new-refresh');

            const result =
                await authService.rotateRefreshToken('concurrent-token');

            expect(result.accessToken).toBe('new-access');
            // Should NOT call smembers (no revocation)
            expect(mockRedis.smembers).not.toHaveBeenCalled();
        });
    });

    describe('revokeRefreshTokenByJwt', () => {
        it('should revoke token from Redis when valid', async () => {
            jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
                sub: 'user-id',
                email: 'test@gmail.com',
                jti: 'some-jti',
            });

            await authService.revokeRefreshTokenByJwt('valid-token');

            expect(mockPipeline.del).toHaveBeenCalledWith('refresh:some-jti');
            expect(mockPipeline.srem).toHaveBeenCalledWith(
                'refresh_family:user-id',
                'some-jti'
            );
        });

        it('should silently succeed for invalid/expired token', async () => {
            jest.spyOn(jwtService, 'verifyAsync').mockRejectedValue(
                new Error('expired')
            );

            await expect(
                authService.revokeRefreshTokenByJwt('expired-token')
            ).resolves.toBeUndefined();
        });

        it('should skip revocation for token without jti', async () => {
            jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
                sub: 'user-id',
                email: 'test@gmail.com',
            });

            await authService.revokeRefreshTokenByJwt('no-jti-token');

            expect(mockPipeline.del).not.toHaveBeenCalled();
        });
    });

    describe('revokeAllUserTokens', () => {
        it('should revoke all tokens for a user', async () => {
            mockRedis.smembers.mockResolvedValue(['jti-1', 'jti-2', 'jti-3']);

            await authService.revokeAllUserTokens('user-id');

            expect(mockRedis.smembers).toHaveBeenCalledWith(
                'refresh_family:user-id'
            );
            expect(mockPipeline.del).toHaveBeenCalledWith('refresh:jti-1');
            expect(mockPipeline.del).toHaveBeenCalledWith('refresh:jti-2');
            expect(mockPipeline.del).toHaveBeenCalledWith('refresh:jti-3');
            expect(mockPipeline.del).toHaveBeenCalledWith(
                'refresh_family:user-id'
            );
        });

        it('should handle user with no active tokens', async () => {
            mockRedis.smembers.mockResolvedValue([]);

            await authService.revokeAllUserTokens('user-id');

            expect(mockPipeline.del).not.toHaveBeenCalled();
        });
    });

    describe('handleGoogleAuth', () => {
        const googleProfile = {
            email: 'test@gmail.com',
            name: 'John Doe',
            avatar: 'https://photo.url',
            providerId: 'google-123',
        };

        it('should find or create user and generate tokens', async () => {
            jest.spyOn(usersService, 'findOrCreateByGoogle').mockResolvedValue(
                mockUser as never
            );
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('access-token')
                .mockResolvedValueOnce('refresh-token');

            const result = await authService.handleGoogleAuth(googleProfile);

            expect(usersService.findOrCreateByGoogle).toHaveBeenCalledWith(
                googleProfile
            );
            expect(result.user).toBe(mockUser);
            expect(result.tokens).toEqual({
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
            });
        });

        it('should return accountDeleted: true for deleted user', async () => {
            const deletedUser = {
                ...mockUser,
                deletedAt: new Date('2026-01-01'),
            };
            jest.spyOn(usersService, 'findOrCreateByGoogle').mockResolvedValue(
                deletedUser as never
            );
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('access-token')
                .mockResolvedValueOnce('refresh-token');

            const result = await authService.handleGoogleAuth(googleProfile);

            expect(result.accountDeleted).toBe(true);
            expect(result.tokens).toEqual({
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
            });
        });

        it('should not include accountDeleted for active user', async () => {
            jest.spyOn(usersService, 'findOrCreateByGoogle').mockResolvedValue(
                mockUser as never
            );
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('access-token')
                .mockResolvedValueOnce('refresh-token');

            const result = await authService.handleGoogleAuth(googleProfile);

            expect(result.accountDeleted).toBeUndefined();
        });
    });

    describe('handleGoogleAuth — Google avatar re-upload', () => {
        const USER_ID = '507f1f77bcf86cd799439011';
        const externalUrl = 'https://lh3.googleusercontent.com/photo.jpg';
        const r2Url = `https://media.test.local/avatars/${USER_ID}/abc.webp`;

        const googleProfile = {
            email: 'test@gmail.com',
            name: 'John Doe',
            avatar: externalUrl,
            providerId: 'google-123',
        };

        const buildUserWithAvatar = (avatar: string) => ({
            id: USER_ID,
            _id: { toString: () => USER_ID },
            email: 'test@gmail.com',
            profile: { name: 'John Doe', avatar } as {
                name: string;
                avatar: string;
            },
            executions: { balance: 0, freeReportUsed: false },
            passwordHash: null as string | null,
            lastLoginAt: null as Date | null,
            save: jest.fn().mockImplementation(function (this: unknown) {
                return Promise.resolve(this);
            }),
        });

        beforeEach(() => {
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('access-token')
                .mockResolvedValueOnce('refresh-token');
        });

        it('re-uploads avatar when it is external (non-R2) and reflects new URL on user doc', async () => {
            const user = buildUserWithAvatar(externalUrl);
            jest.spyOn(usersService, 'findOrCreateByGoogle').mockResolvedValue(
                user as never
            );
            mockAvatarService.syncExternalAvatar.mockResolvedValue(r2Url);

            const result = await authService.handleGoogleAuth(googleProfile);

            expect(mockAvatarService.syncExternalAvatar).toHaveBeenCalledWith(
                USER_ID,
                externalUrl
            );
            // AvatarService persists the new URL itself; AuthService only
            // mirrors it onto the in-memory user document for the response.
            expect(user.profile.avatar).toBe(r2Url);
            expect(user.save).not.toHaveBeenCalled();
            expect(result.user).toBe(user);
            expect(result.tokens).toEqual({
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
            });
        });

        it('no-ops when the avatar is already an R2 URL (AvatarService returns null)', async () => {
            const user = buildUserWithAvatar(r2Url);
            jest.spyOn(usersService, 'findOrCreateByGoogle').mockResolvedValue(
                user as never
            );
            mockAvatarService.syncExternalAvatar.mockResolvedValue(null);

            const result = await authService.handleGoogleAuth(googleProfile);

            expect(mockAvatarService.syncExternalAvatar).toHaveBeenCalledWith(
                USER_ID,
                r2Url
            );
            // null return signals no work was needed; AuthService leaves the
            // doc untouched and does not call save.
            expect(user.save).not.toHaveBeenCalled();
            expect(user.profile.avatar).toBe(r2Url);
            expect(result.user).toBe(user);
        });

        it('warns and continues with the external URL when re-upload fails', async () => {
            const user = buildUserWithAvatar(externalUrl);
            jest.spyOn(usersService, 'findOrCreateByGoogle').mockResolvedValue(
                user as never
            );
            mockAvatarService.syncExternalAvatar.mockRejectedValue(
                new Error('R2 down')
            );

            const result = await authService.handleGoogleAuth(googleProfile);

            expect(mockAvatarService.syncExternalAvatar).toHaveBeenCalledTimes(
                1
            );
            // Avatar mutation only happens AFTER successful re-upload — on
            // failure the external URL must remain as a functional fallback.
            expect(user.save).not.toHaveBeenCalled();
            expect(user.profile.avatar).toBe(externalUrl);
            // Token issuance must still succeed — re-upload is non-critical.
            expect(result.tokens).toEqual({
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
            });
            expect(result.user).toBe(user);
        });

        it('skips re-upload entirely when the user has no avatar', async () => {
            const user = buildUserWithAvatar('');
            // Simulate the realistic shape — avatar absent on fresh account.
            (user.profile as { avatar?: string }).avatar = undefined;
            jest.spyOn(usersService, 'findOrCreateByGoogle').mockResolvedValue(
                user as never
            );

            await authService.handleGoogleAuth(googleProfile);

            expect(mockAvatarService.syncExternalAvatar).not.toHaveBeenCalled();
            expect(user.save).not.toHaveBeenCalled();
        });
    });

    describe('sendDeletionConfirmationEmail', () => {
        it('should call emailService.sendDeletionConfirmation with correct date', async () => {
            const before = new Date();
            before.setDate(before.getDate() + 30);

            await authService.sendDeletionConfirmationEmail('test@gmail.com');

            const after = new Date();
            after.setDate(after.getDate() + 30);

            expect(emailService.sendDeletionConfirmation).toHaveBeenCalledWith({
                email: 'test@gmail.com',
                deletionDate: expect.any(Date),
            });

            const calledDate = (
                emailService.sendDeletionConfirmation as jest.Mock
            ).mock.calls[0][0].deletionDate as Date;
            expect(calledDate.getTime()).toBeGreaterThanOrEqual(
                before.getTime()
            );
            expect(calledDate.getTime()).toBeLessThanOrEqual(after.getTime());
        });
    });

    describe('sendMagicLink', () => {
        const email = 'user@example.com';

        beforeEach(() => {
            mockRedis.get.mockResolvedValue(null);
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(null);
        });

        it('should normalize email, generate token, store JSON in Redis, and send email', async () => {
            mockRedisCounter.incrementFixedWindow.mockResolvedValue(1);

            await authService.sendMagicLink('  User@Example.COM  ');

            // Atomic counter: single call replaces INCR + conditional EXPIRE
            expect(mockRedisCounter.incrementFixedWindow).toHaveBeenCalledWith(
                'ratelimit:magic:user@example.com',
                900
            );
            // Token payload stored as JSON via pipeline
            expect(mockPipeline.set).toHaveBeenCalledWith(
                expect.stringMatching(/^magic:[a-f0-9]{64}$/),
                expect.stringContaining('"email":"user@example.com"'),
                'EX',
                900
            );
            expect(emailService.sendMagicLink).toHaveBeenCalledWith({
                email: 'user@example.com',
                token: expect.stringMatching(/^[a-f0-9]{64}$/),
                purpose: 'login',
                redirectTo: undefined,
            });
        });

        it('should store purpose in Redis JSON payload', async () => {
            mockRedisCounter.incrementFixedWindow.mockResolvedValue(1);

            await authService.sendMagicLink(email, 'register');

            expect(mockPipeline.set).toHaveBeenCalledWith(
                expect.stringMatching(/^magic:/),
                JSON.stringify({ email, purpose: 'register' }),
                'EX',
                900
            );
        });

        it('should default purpose to login', async () => {
            mockRedisCounter.incrementFixedWindow.mockResolvedValue(1);

            await authService.sendMagicLink(email);

            expect(mockPipeline.set).toHaveBeenCalledWith(
                expect.stringMatching(/^magic:/),
                JSON.stringify({ email, purpose: 'login' }),
                'EX',
                900
            );
        });

        it('should send on subsequent requests within limit (count = 2)', async () => {
            mockRedisCounter.incrementFixedWindow.mockResolvedValue(2);

            await authService.sendMagicLink(email);

            expect(emailService.sendMagicLink).toHaveBeenCalled();
        });

        it('should allow up to 3 requests within rate limit window', async () => {
            mockRedisCounter.incrementFixedWindow.mockResolvedValue(3);

            await authService.sendMagicLink(email);

            expect(emailService.sendMagicLink).toHaveBeenCalled();
        });

        it('should throw 429 when rate limit exceeded (4th request)', async () => {
            mockRedisCounter.incrementFixedWindow.mockResolvedValue(4);

            await expect(
                authService.sendMagicLink(email)
            ).rejects.toHaveProperty('status', HttpStatus.TOO_MANY_REQUESTS);
            expect(emailService.sendMagicLink).not.toHaveBeenCalled();
        });

        it('should throw 429 when rate limit is well over max', async () => {
            mockRedisCounter.incrementFixedWindow.mockResolvedValue(10);

            await expect(
                authService.sendMagicLink(email)
            ).rejects.toHaveProperty('status', HttpStatus.TOO_MANY_REQUESTS);
        });

        it('should not leak email in rate limit error message', async () => {
            mockRedisCounter.incrementFixedWindow.mockResolvedValue(4);

            await expect(
                authService.sendMagicLink('secret@example.com')
            ).rejects.toHaveProperty(
                'message',
                expect.not.stringContaining('secret@example.com') as string
            );
        });

        it('should skip sending email if dedup key exists (anti-spam)', async () => {
            // Sprint 10 §SP-8 — dedup-hit йде у overwrite-flow з валідним
            // magic-record-payload-ом (anti-spam invariant збережено: лист
            // повторно не відправляється; replace TTL через KEEPTTL).
            mockRedisCounter.incrementFixedWindow.mockResolvedValue(1);
            mockRedis.get
                .mockResolvedValueOnce('existing-token')
                .mockResolvedValueOnce(
                    JSON.stringify({ email, purpose: 'login' })
                );
            mockRedis.set.mockResolvedValue('OK');

            await authService.sendMagicLink(email);

            expect(emailService.sendMagicLink).not.toHaveBeenCalled();
        });

        it('should rate limit per-email regardless of purpose', async () => {
            mockRedisCounter.incrementFixedWindow.mockResolvedValue(4);

            await expect(
                authService.sendMagicLink(email, 'register')
            ).rejects.toHaveProperty('status', HttpStatus.TOO_MANY_REQUESTS);

            expect(mockRedisCounter.incrementFixedWindow).toHaveBeenCalledWith(
                `ratelimit:magic:${email}`,
                900
            );
        });

        it('should dedup per email+purpose: different purposes both send', async () => {
            mockRedisCounter.incrementFixedWindow.mockResolvedValue(1);
            // Dedup returns null for both — no existing dedup keys
            mockRedis.get.mockResolvedValue(null);

            await authService.sendMagicLink(email, 'login');

            expect(mockRedis.get).toHaveBeenCalledWith(
                `magic_dedup:${email}:login`
            );
            expect(emailService.sendMagicLink).toHaveBeenCalled();
        });

        // ─── Sprint 10 §SP-8 — dedup-overwrite з трьома sibling-fields ───

        describe('dedup-overwrite (Sprint 10 §SP-8)', () => {
            const DRAFT = {
                receiverName: 'Іваненко',
                iban: 'UA213223130000026007233566001',
                taxId: '1234567899',
                purpose: 'Оплата',
            } as const;
            const KEY = '00000000-0000-4000-8000-000000000000';
            const DRAFT_DRIFT = { ...DRAFT, receiverName: 'Петренко' };

            it('(a) перший виклик з 3 полями — write у новий record (no dedup hit)', async () => {
                mockRedisCounter.incrementFixedWindow.mockResolvedValue(1);
                mockRedis.get.mockResolvedValue(null); // no dedup key

                await authService.sendMagicLink(email, 'login', undefined, {
                    landingDraft: DRAFT,
                    claimIdempotencyKey: KEY,
                    termsVersion: 'v2',
                });

                const setCall = mockPipeline.set.mock.calls.find(
                    (c: unknown[]) =>
                        typeof c[0] === 'string' && c[0].startsWith('magic:')
                );
                expect(setCall).toBeDefined();
                const payload = JSON.parse(setCall![1] as string) as Record<
                    string,
                    unknown
                >;
                expect(payload).toMatchObject({
                    email,
                    purpose: 'login',
                    landingDraft: DRAFT,
                    claimIdempotencyKey: KEY,
                    termsVersion: 'v2',
                });
                expect(emailService.sendMagicLink).toHaveBeenCalledTimes(1);
            });

            it('(b) повторний з тими самими 3 полями — KEEPTTL overwrite, лист НЕ відправлено', async () => {
                mockRedisCounter.incrementFixedWindow.mockResolvedValue(1);
                // 1-й get → dedup-key value (existingToken); 2-й get → existing magic-record payload
                mockRedis.get
                    .mockResolvedValueOnce('existing-token-abc')
                    .mockResolvedValueOnce(
                        JSON.stringify({
                            email,
                            purpose: 'login',
                            landingDraft: DRAFT,
                            claimIdempotencyKey: KEY,
                            termsVersion: 'v2',
                        })
                    );
                mockRedis.set.mockResolvedValue('OK');

                await authService.sendMagicLink(email, 'login', undefined, {
                    landingDraft: DRAFT,
                    claimIdempotencyKey: KEY,
                    termsVersion: 'v2',
                });

                expect(mockRedis.set).toHaveBeenCalledWith(
                    'magic:existing-token-abc',
                    expect.any(String),
                    'KEEPTTL'
                );
                expect(emailService.sendMagicLink).not.toHaveBeenCalled();
            });

            it('(c) повторний з drift-нутим landingDraft — record оновлено новим draft, лист НЕ відправлено', async () => {
                mockRedisCounter.incrementFixedWindow.mockResolvedValue(1);
                mockRedis.get
                    .mockResolvedValueOnce('existing-token-abc')
                    .mockResolvedValueOnce(
                        JSON.stringify({
                            email,
                            purpose: 'login',
                            landingDraft: DRAFT,
                            claimIdempotencyKey: KEY,
                        })
                    );
                mockRedis.set.mockResolvedValue('OK');

                await authService.sendMagicLink(email, 'login', undefined, {
                    landingDraft: DRAFT_DRIFT,
                    claimIdempotencyKey: KEY,
                });

                const setArg = mockRedis.set.mock.calls[0][1] as string;
                const payload = JSON.parse(setArg) as Record<string, unknown>;
                expect(payload.landingDraft).toEqual(DRAFT_DRIFT);
                expect(emailService.sendMagicLink).not.toHaveBeenCalled();
            });

            it('(d) повторний без landingDraft+key (reset-password-resend) — drop sibling-fields, termsVersion overwrite-нуто', async () => {
                mockRedisCounter.incrementFixedWindow.mockResolvedValue(1);
                mockRedis.get
                    .mockResolvedValueOnce('existing-token-abc')
                    .mockResolvedValueOnce(
                        JSON.stringify({
                            email,
                            purpose: 'reset-password',
                            landingDraft: DRAFT,
                            claimIdempotencyKey: KEY,
                            termsVersion: 'v1',
                        })
                    );
                mockRedis.set.mockResolvedValue('OK');

                await authService.sendMagicLink(
                    email,
                    'reset-password',
                    undefined,
                    { termsVersion: 'v2' }
                );

                const setArg = mockRedis.set.mock.calls[0][1] as string;
                const payload = JSON.parse(setArg) as Record<string, unknown>;
                expect(payload.landingDraft).toBeUndefined();
                expect(payload.claimIdempotencyKey).toBeUndefined();
                expect(payload.termsVersion).toBe('v2');
                expect(emailService.sendMagicLink).not.toHaveBeenCalled();
            });

            it('(e) змішаний flow — перший без sibling-fields, потім з; overwrite додає у той самий token-record', async () => {
                mockRedisCounter.incrementFixedWindow.mockResolvedValue(1);
                mockRedis.get
                    .mockResolvedValueOnce('existing-token-abc')
                    .mockResolvedValueOnce(
                        JSON.stringify({
                            email,
                            purpose: 'login',
                        })
                    );
                mockRedis.set.mockResolvedValue('OK');

                await authService.sendMagicLink(email, 'login', undefined, {
                    landingDraft: DRAFT,
                    claimIdempotencyKey: KEY,
                    termsVersion: 'v2',
                });

                const setArg = mockRedis.set.mock.calls[0][1] as string;
                const payload = JSON.parse(setArg) as Record<string, unknown>;
                expect(payload).toMatchObject({
                    email,
                    purpose: 'login',
                    landingDraft: DRAFT,
                    claimIdempotencyKey: KEY,
                    termsVersion: 'v2',
                });
                expect(emailService.sendMagicLink).not.toHaveBeenCalled();
            });
        });
    });

    describe('verifyMagicLink', () => {
        const token = 'a'.repeat(64);

        it('should atomically consume token, create user, and return tokens + purpose', async () => {
            mockRedis.getdel.mockResolvedValue(
                JSON.stringify({ email: 'user@example.com', purpose: 'login' })
            );
            const saveMock = jest.fn().mockResolvedValue(mockUser);
            jest.spyOn(usersService, 'findOrCreateByEmail').mockResolvedValue({
                ...mockUser,
                save: saveMock,
            } as never);
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('access-token')
                .mockResolvedValueOnce('refresh-token');

            const result = await authService.verifyMagicLink(token);

            expect(mockRedis.getdel).toHaveBeenCalledWith(`magic:${token}`);
            expect(usersService.findOrCreateByEmail).toHaveBeenCalledWith(
                'user@example.com'
            );
            expect(result.purpose).toBe('login');
            expect('tokens' in result && result.tokens).toEqual({
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
            });
        });

        it('should return correct purpose from Redis payload', async () => {
            mockRedis.getdel.mockResolvedValue(
                JSON.stringify({
                    email: 'user@example.com',
                    purpose: 'reset-password',
                })
            );
            const saveMock = jest.fn().mockResolvedValue(mockUser);
            jest.spyOn(usersService, 'findOrCreateByEmail').mockResolvedValue({
                ...mockUser,
                save: saveMock,
            } as never);
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('access-token')
                .mockResolvedValueOnce('refresh-token');

            const result = await authService.verifyMagicLink(token);

            expect(result.purpose).toBe('reset-password');
        });

        it('should return purpose register from Redis payload', async () => {
            mockRedis.getdel.mockResolvedValue(
                JSON.stringify({
                    email: 'user@example.com',
                    purpose: 'register',
                })
            );
            const saveMock = jest.fn().mockResolvedValue(mockUser);
            jest.spyOn(usersService, 'findOrCreateByEmail').mockResolvedValue({
                ...mockUser,
                save: saveMock,
            } as never);
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('access-token')
                .mockResolvedValueOnce('refresh-token');

            const result = await authService.verifyMagicLink(token);

            expect(result.purpose).toBe('register');
        });

        it('should update lastLoginAt on verify', async () => {
            mockRedis.getdel.mockResolvedValue(
                JSON.stringify({ email: 'user@example.com', purpose: 'login' })
            );
            const saveMock = jest.fn().mockResolvedValue(mockUser);
            const userObj = {
                ...mockUser,
                lastLoginAt: null as Date | null,
                save: saveMock,
            };
            jest.spyOn(usersService, 'findOrCreateByEmail').mockResolvedValue(
                userObj as never
            );
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('access-token')
                .mockResolvedValueOnce('refresh-token');

            await authService.verifyMagicLink(token);

            expect(userObj.lastLoginAt).toBeInstanceOf(Date);
            expect(saveMock).toHaveBeenCalled();
        });

        it('should throw UnauthorizedException for invalid token', async () => {
            mockRedis.getdel.mockResolvedValue(null);

            await expect(
                authService.verifyMagicLink('invalid-token')
            ).rejects.toThrow('Invalid or expired magic link token');
        });

        it('should throw UnauthorizedException for expired token', async () => {
            mockRedis.getdel.mockResolvedValue(null);

            await expect(authService.verifyMagicLink(token)).rejects.toThrow(
                'Invalid or expired magic link token'
            );
        });

        it('should soft-delete user and revoke tokens for delete-account purpose', async () => {
            mockRedis.getdel.mockResolvedValue(
                JSON.stringify({
                    email: 'user@example.com',
                    purpose: 'delete-account',
                })
            );
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue({
                ...mockUser,
                _id: { toString: () => '507f1f77bcf86cd799439011' },
            } as never);
            mockRedis.smembers.mockResolvedValue([]);

            const result = await authService.verifyMagicLink(token);

            expect(result.deleted).toBe(true);
            expect(result.purpose).toBe('delete-account');
            expect(usersService.softDelete).toHaveBeenCalledWith(
                '507f1f77bcf86cd799439011'
            );
            expect(mockRedis.smembers).toHaveBeenCalledWith(
                'refresh_family:507f1f77bcf86cd799439011'
            );
            expect(emailService.sendDeletionConfirmation).toHaveBeenCalledWith({
                email: 'user@example.com',
                deletionDate: expect.any(Date),
            });
        });

        it('should throw NotFoundException for delete-account if user not found', async () => {
            mockRedis.getdel.mockResolvedValue(
                JSON.stringify({
                    email: 'unknown@example.com',
                    purpose: 'delete-account',
                })
            );
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(null);

            await expect(authService.verifyMagicLink(token)).rejects.toThrow(
                NotFoundException
            );
        });

        it('should not create user for delete-account purpose', async () => {
            mockRedis.getdel.mockResolvedValue(
                JSON.stringify({
                    email: 'user@example.com',
                    purpose: 'delete-account',
                })
            );
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue({
                ...mockUser,
                _id: { toString: () => '507f1f77bcf86cd799439011' },
            } as never);
            mockRedis.smembers.mockResolvedValue([]);

            await authService.verifyMagicLink(token);

            expect(usersService.findOrCreateByEmail).not.toHaveBeenCalled();
        });

        it('should return accountDeleted for user with deletedAt', async () => {
            mockRedis.getdel.mockResolvedValue(
                JSON.stringify({
                    email: 'user@example.com',
                    purpose: 'login',
                })
            );
            const deletedUser = {
                ...mockUser,
                deletedAt: new Date('2026-01-01'),
                save: jest.fn().mockImplementation(function (this: unknown) {
                    return Promise.resolve(this);
                }),
            };
            jest.spyOn(usersService, 'findOrCreateByEmail').mockResolvedValue(
                deletedUser as never
            );
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('access-token')
                .mockResolvedValueOnce('refresh-token');

            const result = await authService.verifyMagicLink(token);

            expect(result.deleted).toBeFalsy();
            expect('accountDeleted' in result && result.accountDeleted).toBe(
                true
            );
        });

        it('should not include accountDeleted for active user on verify', async () => {
            mockRedis.getdel.mockResolvedValue(
                JSON.stringify({
                    email: 'user@example.com',
                    purpose: 'login',
                })
            );
            const saveMock = jest.fn().mockResolvedValue(mockUser);
            jest.spyOn(usersService, 'findOrCreateByEmail').mockResolvedValue({
                ...mockUser,
                deletedAt: null,
                save: saveMock,
            } as never);
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('access-token')
                .mockResolvedValueOnce('refresh-token');

            const result = await authService.verifyMagicLink(token);

            expect(
                'accountDeleted' in result ? result.accountDeleted : undefined
            ).toBeUndefined();
        });

        // Sprint 13 §13 — orchestration of stamp + claim переїхала у
        // AuthController. AuthService.verifyMagicLink сам нічого не stamp-ить
        // і не claim-ить; повертає `rawPayload` для оркестратора. Тести цих
        // двох викликів живуть у `auth.controller.spec.ts`.

        describe('rawPayload propagation (Sprint 13)', () => {
            const DRAFT = {
                receiverName: 'Іваненко',
                iban: 'UA213223130000026007233566001',
                taxId: '1234567899',
                purpose: 'Оплата',
            } as const;
            const KEY = '00000000-0000-4000-8000-000000000000';

            const seedMagicPayload = (extra: Record<string, unknown>) => {
                mockRedis.getdel.mockResolvedValue(
                    JSON.stringify({
                        email: 'user@example.com',
                        purpose: 'login',
                        ...extra,
                    })
                );
                const saveMock = jest.fn().mockResolvedValue(mockUser);
                jest.spyOn(
                    usersService,
                    'findOrCreateByEmail'
                ).mockResolvedValue({
                    ...mockUser,
                    deletedAt: null,
                    save: saveMock,
                } as never);
                jest.spyOn(jwtService, 'signAsync')
                    .mockResolvedValueOnce('access-token')
                    .mockResolvedValueOnce('refresh-token');
            };

            it('propagates all three optional sibling-fields from Redis payload', async () => {
                seedMagicPayload({
                    landingDraft: DRAFT,
                    claimIdempotencyKey: KEY,
                    termsVersion: 'v3',
                });

                const result = await authService.verifyMagicLink(token);

                expect(result.deleted).toBeFalsy();
                expect(
                    'rawPayload' in result ? result.rawPayload : null
                ).toEqual({
                    landingDraft: DRAFT,
                    claimIdempotencyKey: KEY,
                    termsVersion: 'v3',
                });
            });

            it('returns rawPayload with undefined fields when payload had none', async () => {
                seedMagicPayload({});

                const result = await authService.verifyMagicLink(token);

                expect(
                    'rawPayload' in result ? result.rawPayload : null
                ).toEqual({
                    landingDraft: undefined,
                    claimIdempotencyKey: undefined,
                    termsVersion: undefined,
                });
            });
        });
    });

    describe('checkEmail', () => {
        const ip = '192.168.1.1';

        beforeEach(() => {
            mockRedis.get.mockResolvedValue(null);
            // Default: counter starts at 1 (well under the 10-request limit)
            mockRedisCounter.incrementSlidingWindow.mockResolvedValue(1);
        });

        it('should return hasPassword: true for existing user with password', async () => {
            const userWithPassword = {
                ...mockUser,
                passwordHash: '$2b$10$hash',
            };
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(
                userWithPassword as never
            );

            const result = await authService.checkEmail('test@gmail.com', ip);

            expect(result).toEqual({ hasPassword: true, isNewUser: false });
        });

        it('should return hasPassword: false for existing user without password', async () => {
            const userNoPassword = { ...mockUser, passwordHash: null };
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(
                userNoPassword as never
            );

            const result = await authService.checkEmail('test@gmail.com', ip);

            expect(result).toEqual({ hasPassword: false, isNewUser: false });
        });

        it('should return isNewUser: true for non-existing user', async () => {
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(null);

            const result = await authService.checkEmail('new@gmail.com', ip);

            expect(result).toEqual({ hasPassword: false, isNewUser: true });
        });

        it('should normalize email (trim + lowercase)', async () => {
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(null);

            await authService.checkEmail('  Test@Gmail.COM  ', ip);

            expect(usersService.findByEmail).toHaveBeenCalledWith(
                'test@gmail.com'
            );
        });

        it('should allow up to 10 requests per IP (10th still passes)', async () => {
            mockRedisCounter.incrementSlidingWindow.mockResolvedValue(10);
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(null);

            await expect(
                authService.checkEmail('test@gmail.com', ip)
            ).resolves.toBeDefined();
        });

        it('should throw 429 on 11th request from same IP', async () => {
            mockRedisCounter.incrementSlidingWindow.mockResolvedValue(11);

            await expect(
                authService.checkEmail('test@gmail.com', ip)
            ).rejects.toHaveProperty('status', HttpStatus.TOO_MANY_REQUESTS);
        });

        it('should use atomic sliding-window counter for rate limit', async () => {
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(null);

            await authService.checkEmail('test@gmail.com', ip);

            expect(
                mockRedisCounter.incrementSlidingWindow
            ).toHaveBeenCalledWith(`check_email:${ip}`, 60);
        });
    });

    describe('loginWithPassword', () => {
        const ip = '192.168.1.1';
        const email = 'test@gmail.com';
        const password = 'securepass123';
        const hashedPassword = '$2b$10$hashedpassword';

        const userWithPassword = {
            ...mockUser,
            passwordHash: hashedPassword,
            save: jest.fn().mockImplementation(function (this: unknown) {
                return Promise.resolve(this);
            }),
        };

        beforeEach(() => {
            mockRedis.get.mockResolvedValue(null);
            mockUser.save.mockClear();
        });

        it('should return user and tokens on valid credentials', async () => {
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(
                userWithPassword as never
            );
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('access-token')
                .mockResolvedValueOnce('refresh-token');

            const result = await authService.loginWithPassword(
                email,
                password,
                ip
            );

            expect(result.user).toBe(userWithPassword);
            expect(result.accessToken).toBe('access-token');
            expect(result.refreshToken).toBe('refresh-token');
        });

        it('should throw 401 and increment attempts on invalid password', async () => {
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(
                userWithPassword as never
            );
            (bcrypt.compare as jest.Mock).mockResolvedValue(false);

            await expect(
                authService.loginWithPassword(email, password, ip)
            ).rejects.toThrow('Invalid email or password');

            expect(
                mockRedisCounter.incrementSlidingWindow
            ).toHaveBeenCalledWith(`login_attempts:${ip}:${email}`, 900);
        });

        it('should throw 401 and increment attempts when user not found', async () => {
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(null);

            await expect(
                authService.loginWithPassword(email, password, ip)
            ).rejects.toThrow('Invalid email or password');

            expect(
                mockRedisCounter.incrementSlidingWindow
            ).toHaveBeenCalledWith(`login_attempts:${ip}:${email}`, 900);
        });

        it('should throw 401 and increment attempts when user has no password', async () => {
            const userNoPassword = { ...mockUser, passwordHash: null };
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(
                userNoPassword as never
            );

            await expect(
                authService.loginWithPassword(email, password, ip)
            ).rejects.toThrow('Invalid email or password');

            expect(
                mockRedisCounter.incrementSlidingWindow
            ).toHaveBeenCalledWith(`login_attempts:${ip}:${email}`, 900);
        });

        it('should throw 429 after 5 failed attempts (1 min block)', async () => {
            mockRedis.get.mockResolvedValue('5');

            await expect(
                authService.loginWithPassword(email, password, ip)
            ).rejects.toHaveProperty('status', HttpStatus.TOO_MANY_REQUESTS);
        });

        it('should throw 429 after 10 failed attempts (5 min block)', async () => {
            mockRedis.get.mockResolvedValue('10');

            await expect(
                authService.loginWithPassword(email, password, ip)
            ).rejects.toMatchObject({
                status: HttpStatus.TOO_MANY_REQUESTS,
                message: expect.stringContaining('5 minutes') as string,
            });
        });

        it('should throw 429 after 20 failed attempts (15 min block)', async () => {
            mockRedis.get.mockResolvedValue('20');

            await expect(
                authService.loginWithPassword(email, password, ip)
            ).rejects.toMatchObject({
                status: HttpStatus.TOO_MANY_REQUESTS,
                message: expect.stringContaining('15 minutes') as string,
            });
        });

        it('should not block different IP for same email', async () => {
            mockRedis.get.mockResolvedValue(null);
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(
                userWithPassword as never
            );
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('access-token')
                .mockResolvedValueOnce('refresh-token');

            const result = await authService.loginWithPassword(
                email,
                password,
                '10.0.0.1'
            );

            expect(mockRedis.get).toHaveBeenCalledWith(
                `login_attempts:10.0.0.1:${email}`
            );
            expect(result.accessToken).toBe('access-token');
        });

        it('should clear login attempts on successful login', async () => {
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(
                userWithPassword as never
            );
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('access-token')
                .mockResolvedValueOnce('refresh-token');

            await authService.loginWithPassword(email, password, ip);

            expect(mockRedis.del).toHaveBeenCalledWith(
                `login_attempts:${ip}:${email}`
            );
        });

        it('should update lastLoginAt on successful login', async () => {
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(
                userWithPassword as never
            );
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('access-token')
                .mockResolvedValueOnce('refresh-token');

            await authService.loginWithPassword(email, password, ip);

            expect(userWithPassword.lastLoginAt).toBeInstanceOf(Date);
            expect(userWithPassword.save).toHaveBeenCalled();
        });

        it('should return accountDeleted: true for deleted user', async () => {
            const deletedUser = {
                ...userWithPassword,
                deletedAt: new Date('2026-01-01'),
                save: jest.fn().mockImplementation(function (this: unknown) {
                    return Promise.resolve(this);
                }),
            };
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(
                deletedUser as never
            );
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('access-token')
                .mockResolvedValueOnce('refresh-token');

            const result = await authService.loginWithPassword(
                email,
                password,
                ip
            );

            expect(result.accountDeleted).toBe(true);
            expect(result.accessToken).toBe('access-token');
        });

        it('should not include accountDeleted for active user', async () => {
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(
                userWithPassword as never
            );
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('access-token')
                .mockResolvedValueOnce('refresh-token');

            const result = await authService.loginWithPassword(
                email,
                password,
                ip
            );

            expect(result.accountDeleted).toBeUndefined();
        });

        it('should normalize email (trim + toLowerCase) before lookup', async () => {
            jest.spyOn(usersService, 'findByEmail').mockResolvedValue(
                userWithPassword as never
            );
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('access-token')
                .mockResolvedValueOnce('refresh-token');

            await authService.loginWithPassword(
                '  Test@Gmail.COM  ',
                password,
                ip
            );

            expect(usersService.findByEmail).toHaveBeenCalledWith(
                'test@gmail.com'
            );
        });
    });

    describe('setPassword', () => {
        const userId = '507f1f77bcf86cd799439011';

        it('should hash and set password for user without password', async () => {
            jest.spyOn(usersService, 'findById').mockResolvedValue({
                ...mockUser,
                passwordHash: null,
            } as never);

            await authService.setPassword(userId, 'newPassword123');

            expect(bcrypt.hash).toHaveBeenCalledWith('newPassword123', 10);
            expect(usersService.setPasswordHash).toHaveBeenCalledWith(
                userId,
                '$2b$10$newhash'
            );
        });

        it('should throw BadRequestException if password already set', async () => {
            jest.spyOn(usersService, 'findById').mockResolvedValue({
                ...mockUser,
                passwordHash: '$2b$10$existinghash',
            } as never);

            await expect(
                authService.setPassword(userId, 'newPassword123')
            ).rejects.toThrow(BadRequestException);
        });

        it('should throw NotFoundException if user not found', async () => {
            jest.spyOn(usersService, 'findById').mockResolvedValue(null);

            await expect(
                authService.setPassword(userId, 'newPassword123')
            ).rejects.toThrow(NotFoundException);
        });
    });

    describe('changePassword', () => {
        const userId = '507f1f77bcf86cd799439011';

        it('should change password, revoke all tokens, and return new token pair', async () => {
            jest.spyOn(usersService, 'findById').mockResolvedValue({
                ...mockUser,
                passwordHash: '$2b$10$oldhash',
            } as never);
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            mockRedis.smembers.mockResolvedValue(['jti-1']);
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('new-access')
                .mockResolvedValueOnce('new-refresh');

            const result = await authService.changePassword(
                userId,
                'oldPass',
                'newPass'
            );

            expect(bcrypt.compare).toHaveBeenCalledWith(
                'oldPass',
                '$2b$10$oldhash'
            );
            expect(bcrypt.hash).toHaveBeenCalledWith('newPass', 10);
            expect(usersService.setPasswordHash).toHaveBeenCalledWith(
                userId,
                '$2b$10$newhash'
            );
            // revokeAllUserTokens was called
            expect(mockRedis.smembers).toHaveBeenCalledWith(
                `refresh_family:${userId}`
            );
            expect(result).toEqual({
                accessToken: 'new-access',
                refreshToken: 'new-refresh',
            });
        });

        it('should throw UnauthorizedException on invalid current password', async () => {
            jest.spyOn(usersService, 'findById').mockResolvedValue({
                ...mockUser,
                passwordHash: '$2b$10$oldhash',
            } as never);
            (bcrypt.compare as jest.Mock).mockResolvedValue(false);

            await expect(
                authService.changePassword(userId, 'wrongPass', 'newPass')
            ).rejects.toThrow(UnauthorizedException);
        });

        it('should throw BadRequestException if no password set', async () => {
            jest.spyOn(usersService, 'findById').mockResolvedValue({
                ...mockUser,
                passwordHash: null,
            } as never);

            await expect(
                authService.changePassword(userId, 'oldPass', 'newPass')
            ).rejects.toThrow(BadRequestException);
        });

        it('should throw BadRequestException if user not found', async () => {
            jest.spyOn(usersService, 'findById').mockResolvedValue(null);

            await expect(
                authService.changePassword(userId, 'oldPass', 'newPass')
            ).rejects.toThrow(BadRequestException);
        });

        it('should issue new tokens after revoking all sessions', async () => {
            jest.spyOn(usersService, 'findById').mockResolvedValue({
                ...mockUser,
                passwordHash: '$2b$10$oldhash',
            } as never);
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            mockRedis.smembers.mockResolvedValue([]);
            jest.spyOn(jwtService, 'signAsync')
                .mockResolvedValueOnce('fresh-access')
                .mockResolvedValueOnce('fresh-refresh');

            const result = await authService.changePassword(
                userId,
                'oldPass',
                'newPass'
            );

            expect(result.accessToken).toBe('fresh-access');
            expect(result.refreshToken).toBe('fresh-refresh');
        });
    });

    describe('verifyPassword', () => {
        const userId = '507f1f77bcf86cd799439011';

        it('should return true for valid password', async () => {
            jest.spyOn(usersService, 'findById').mockResolvedValue({
                ...mockUser,
                passwordHash: '$2b$10$hash',
            } as never);
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);

            const result = await authService.verifyPassword(userId, 'correct');

            expect(bcrypt.compare).toHaveBeenCalledWith(
                'correct',
                '$2b$10$hash'
            );
            expect(result).toBe(true);
        });

        it('should return false for invalid password', async () => {
            jest.spyOn(usersService, 'findById').mockResolvedValue({
                ...mockUser,
                passwordHash: '$2b$10$hash',
            } as never);
            (bcrypt.compare as jest.Mock).mockResolvedValue(false);

            const result = await authService.verifyPassword(userId, 'wrong');

            expect(result).toBe(false);
        });

        it('should return false if no password set', async () => {
            jest.spyOn(usersService, 'findById').mockResolvedValue({
                ...mockUser,
                passwordHash: null,
            } as never);

            const result = await authService.verifyPassword(userId, 'any');

            expect(result).toBe(false);
        });

        it('should return false if user not found', async () => {
            jest.spyOn(usersService, 'findById').mockResolvedValue(null);

            const result = await authService.verifyPassword(userId, 'any');

            expect(result).toBe(false);
        });
    });
});
