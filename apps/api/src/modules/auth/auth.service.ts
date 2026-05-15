import { randomBytes, randomUUID } from 'crypto';

import * as bcrypt from 'bcrypt';
import {
    BadRequestException,
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
    MAGIC_LINK_PURPOSE,
    type LandingClaimResult,
    type LandingDraft,
    type MagicLinkPurpose,
} from '@finly/types';
import Redis from 'ioredis';

import { REDIS_CLIENT } from '../../common/modules/redis.module';
import { RedisCounterService } from '../../common/services/redis-counter.service';
import { ENV, parseLockoutThresholds } from '../../config/env';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { LandingClaimService } from '../landing-claim/landing-claim.service';
import { StorageService } from '../storage/storage.service';
import { GoogleValidatedUser } from './strategies/google.strategy';

/**
 * Sprint 10 §SP-7/§SP-11/§SP-12 — anon-claim sibling-fields у magic-link
 * payload. Усі три optional. Cross-field-coexistence (`landingDraft ↔
 * claimIdempotencyKey`) забезпечена `SendMagicLinkSchema`-refine на write-side,
 * service отримує уже-валідовані pair-и; `termsVersion` — окремий optional-
 * field без cross-coupling.
 */
export interface SendMagicLinkOptions {
    landingDraft?: LandingDraft;
    claimIdempotencyKey?: string;
    termsVersion?: string;
}

interface MagicLinkPayload {
    email: string;
    purpose: MagicLinkPurpose;
    redirectTo?: string;
    landingDraft?: LandingDraft;
    claimIdempotencyKey?: string;
    termsVersion?: string;
}

interface TokenPair {
    accessToken: string;
    refreshToken: string;
}

interface JwtPayload {
    sub: string;
    email: string;
    jti?: string;
}

const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days
const ROTATION_GRACE_PERIOD = 10; // 10 seconds for concurrent tab requests

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private readonly jwtService: JwtService,
        private readonly usersService: UsersService,
        private readonly emailService: EmailService,
        private readonly storageService: StorageService,
        private readonly landingClaimService: LandingClaimService,
        @Inject(REDIS_CLIENT) private readonly redis: Redis,
        private readonly redisCounter: RedisCounterService
    ) {}

    async generateTokens(userId: string, email: string): Promise<TokenPair> {
        const jti = randomUUID();
        const accessPayload: JwtPayload = { sub: userId, email };
        const refreshPayload: JwtPayload = { sub: userId, email, jti };

        const [accessToken, refreshToken] = await Promise.all([
            this.jwtService.signAsync(accessPayload, {
                secret: ENV.JWT_ACCESS_SECRET,
                expiresIn: '1h',
            }),
            this.jwtService.signAsync(refreshPayload, {
                secret: ENV.JWT_REFRESH_SECRET,
                expiresIn: '7d',
            }),
        ]);

        await this.storeRefreshToken(userId, jti);

        return { accessToken, refreshToken };
    }

    async rotateRefreshToken(
        token: string,
        timezone?: string
    ): Promise<TokenPair> {
        let payload: JwtPayload;

        try {
            payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
                secret: ENV.JWT_REFRESH_SECRET,
            });
        } catch {
            throw new UnauthorizedException('Invalid or expired refresh token');
        }

        const { sub: userId, email, jti } = payload;

        if (!jti) {
            throw new UnauthorizedException('Invalid refresh token format');
        }

        // Atomic consume: GETDEL ensures only one request can use the token
        const storedValue = await this.redis.getdel(`refresh:${jti}`);

        if (!storedValue) {
            // Token reuse detected — revoke ALL tokens for this user
            await this.revokeAllUserTokens(userId);
            throw new UnauthorizedException('Refresh token reuse detected');
        }

        if (storedValue === 'rotated') {
            // Grace period: one extra use allowed for concurrent tab
            return this.generateTokens(userId, email);
        }

        if (storedValue !== userId) {
            throw new UnauthorizedException('Token user mismatch');
        }

        // Mark old token as rotated with short grace period (one-time use via GETDEL above)
        await this.redis.set(
            `refresh:${jti}`,
            'rotated',
            'EX',
            ROTATION_GRACE_PERIOD
        );
        await this.redis.srem(`refresh_family:${userId}`, jti);

        if (timezone) {
            this.usersService
                .updateTimezone(userId, timezone)
                .catch((error) => {
                    this.logger.warn(
                        `Failed to update timezone for user ${userId}: ${(error as Error).message}`
                    );
                });
        }

        return this.generateTokens(userId, email);
    }

    async revokeAllUserTokens(userId: string): Promise<void> {
        const jtis = await this.redis.smembers(`refresh_family:${userId}`);

        if (jtis.length > 0) {
            const pipeline = this.redis.pipeline();
            for (const jti of jtis) {
                pipeline.del(`refresh:${jti}`);
            }
            pipeline.del(`refresh_family:${userId}`);
            await pipeline.exec();
        }
    }

    async revokeRefreshTokenByJwt(token: string): Promise<void> {
        try {
            const payload = await this.jwtService.verifyAsync<JwtPayload>(
                token,
                { secret: ENV.JWT_REFRESH_SECRET }
            );

            if (payload.jti) {
                await this.revokeRefreshToken(payload.jti, payload.sub);
            }
        } catch {
            // Token is invalid/expired — nothing to revoke
        }
    }

    async handleGoogleAuth(googleProfile: GoogleValidatedUser): Promise<{
        user: UserDocument;
        tokens: TokenPair;
        accountDeleted?: boolean;
    }> {
        const user =
            await this.usersService.findOrCreateByGoogle(googleProfile);

        // Re-upload external Google avatar to R2 synchronously. The sync path
        // adds ~300-800ms to the callback but avoids a URL jump after login.
        // Failure is non-critical — the external URL remains as a functional
        // fallback and the next login retries.
        if (
            user.profile.avatar &&
            !this.storageService.isR2Url(user.profile.avatar)
        ) {
            try {
                const r2Url = await this.storageService.reUploadExternalAvatar(
                    user.id as string,
                    user.profile.avatar
                );
                user.profile.avatar = r2Url;
                await user.save();
            } catch (err) {
                this.logger.warn(
                    `Failed to re-upload Google avatar for user ${user.id as string}: ${(err as Error).message}`
                );
            }
        }

        const tokens = await this.generateTokens(user.id as string, user.email);

        return {
            user,
            tokens,
            accountDeleted: user.deletedAt ? true : undefined,
        };
    }

    async sendMagicLink(
        email: string,
        purpose: MagicLinkPurpose = MAGIC_LINK_PURPOSE.LOGIN,
        redirectTo?: string,
        options?: SendMagicLinkOptions
    ): Promise<void> {
        const normalizedEmail = email.trim().toLowerCase();
        const rateLimitKey = `ratelimit:magic:${normalizedEmail}`;
        const rateLimitTtl = ENV.AUTH_MAGIC_LINK_RATE_WINDOW_MIN * 60;

        // Atomic INCR + first-call EXPIRE via Lua. Prevents permanent counter
        // retention if the process dies between INCR and EXPIRE — that bug would
        // permanently block magic link sends to the affected email.
        const count = await this.redisCounter.incrementFixedWindow(
            rateLimitKey,
            rateLimitTtl
        );

        if (count > ENV.AUTH_MAGIC_LINK_RATE_LIMIT) {
            throw new TooManyRequestsException();
        }

        // Anti-spam dedup + Sprint 10 §SP-8 overwrite-flow.
        const dedupKey = `magic_dedup:${normalizedEmail}:${purpose}`;
        const existingDedupToken = await this.redis.get(dedupKey);
        if (existingDedupToken) {
            const existingMagicKey = `magic:${existingDedupToken}`;
            const existingRaw = await this.redis.get(existingMagicKey);
            if (existingRaw) {
                // Sprint 10 §SP-8 symmetric overwrite/drop трьох sibling-fields:
                // повний rebuild payload-у з нового request input-у (existing
                // email/purpose + поточний redirectTo + поточні sibling-fields).
                // Жоден з трьох НЕ "залипає" — якщо новий запит без поля, воно
                // зникає з Redis-payload-у; якщо з — overwrite-ується.
                const existing = JSON.parse(existingRaw) as MagicLinkPayload;
                const overwritten = this.buildMagicLinkPayload(
                    existing.email,
                    existing.purpose,
                    redirectTo,
                    options
                );
                // KEEPTTL критично: без нього SET reset-нув би TTL і відкрив
                // vector "n→∞ overwrites продовжують magic-link до нескінченності".
                await this.redis.set(
                    existingMagicKey,
                    JSON.stringify(overwritten),
                    'KEEPTTL'
                );
                // anti-spam invariant збережено: лист повторно НЕ відправляємо.
                return;
            }
            // Race: dedup-key пережив magic-record-у. Структурно неможливо
            // при env-invariant AUTH_MAGIC_LINK_TTL_MIN * 60 ≥
            // AUTH_MAGIC_LINK_DEDUP_SEC (fail-fast у config/env.ts). Fall-
            // through на normal-flow як defense-in-depth.
        }

        const token = randomBytes(32).toString('hex');
        const payload = this.buildMagicLinkPayload(
            normalizedEmail,
            purpose,
            redirectTo,
            options
        );
        const magicLinkTtl = ENV.AUTH_MAGIC_LINK_TTL_MIN * 60;

        const pipeline = this.redis.pipeline();
        pipeline.set(
            `magic:${token}`,
            JSON.stringify(payload),
            'EX',
            magicLinkTtl
        );
        pipeline.set(dedupKey, token, 'EX', ENV.AUTH_MAGIC_LINK_DEDUP_SEC);
        await pipeline.exec();

        await this.emailService.sendMagicLink({
            email: normalizedEmail,
            token,
            purpose,
            redirectTo,
        });
    }

    private buildMagicLinkPayload(
        email: string,
        purpose: MagicLinkPurpose,
        redirectTo: string | undefined,
        options: SendMagicLinkOptions | undefined
    ): MagicLinkPayload {
        // landingDraft + claimIdempotencyKey мусять coexist — SendMagicLinkSchema
        // cross-field-refine reject-ить mismatched-pair на write-side, тому
        // service гарантовано отримує валідну пару або обидва undefined.
        const hasClaim =
            options?.landingDraft !== undefined &&
            options?.claimIdempotencyKey !== undefined;
        return {
            email,
            purpose,
            ...(redirectTo && { redirectTo }),
            ...(hasClaim && {
                landingDraft: options.landingDraft,
                claimIdempotencyKey: options.claimIdempotencyKey,
            }),
            ...(options?.termsVersion && {
                termsVersion: options.termsVersion,
            }),
        };
    }

    async verifyMagicLink(token: string): Promise<
        | {
              user: UserDocument;
              tokens: TokenPair;
              purpose: MagicLinkPurpose;
              deleted?: false;
              accountDeleted?: boolean;
              claimResult?: LandingClaimResult;
          }
        | {
              deleted: true;
              message: string;
              purpose: typeof MAGIC_LINK_PURPOSE.DELETE_ACCOUNT;
          }
    > {
        const magicKey = `magic:${token}`;
        const raw = await this.redis.getdel(magicKey);

        if (!raw) {
            throw new UnauthorizedException(
                'Invalid or expired magic link token'
            );
        }

        const payload = JSON.parse(raw) as MagicLinkPayload;
        const { email, purpose } = payload;

        if (purpose === MAGIC_LINK_PURPOSE.DELETE_ACCOUNT) {
            // Sprint 10 — combination `purpose=delete-account + landingDraft`
            // структурно неможлива (public endpoint reject-ає delete-account
            // purpose у SendMagicLinkDto). Тому terms-stamp + claim тут не
            // викликаємо — delete-flow повністю окремий.
            return this.handleDeleteAccountVerification(email);
        }

        // Order-of-operations Sprint 10 §10.1 (для login / register /
        // reset-password):
        //   1. Auth-resolve user.
        //   2. Terms pre-stamp (SP-12) — закриває acceptTerms ordering window.
        //   3. Landing claim (SP-7 / SP-11) — БЕЗ throw на failure (повертає
        //      discriminated state).
        //   4. Видача session-credentials.
        const user = await this.usersService.findOrCreateByEmail(email);

        user.lastLoginAt = new Date();
        await user.save();

        if (payload.termsVersion) {
            await this.usersService.stampAcceptedTerms(
                user._id.toString(),
                payload.termsVersion
            );
        }

        let claimResult: LandingClaimResult | undefined;
        if (payload.landingDraft && payload.claimIdempotencyKey) {
            claimResult = await this.landingClaimService.attemptLandingClaim(
                {
                    userId: user._id.toString(),
                    isBookkeeperMode: user.worksAsBookkeeper ?? false,
                },
                payload.landingDraft,
                payload.claimIdempotencyKey
            );
        }

        const tokens = await this.generateTokens(
            user._id.toString(),
            user.email
        );

        return {
            user,
            tokens,
            purpose,
            accountDeleted: user.deletedAt ? true : undefined,
            claimResult,
        };
    }

    async sendDeletionConfirmationEmail(email: string): Promise<void> {
        const deletionDate = new Date();
        deletionDate.setDate(
            deletionDate.getDate() + ENV.ACCOUNT_DELETION_GRACE_DAYS
        );
        await this.emailService.sendDeletionConfirmation({
            email,
            deletionDate,
        });
    }

    private async handleDeleteAccountVerification(email: string): Promise<{
        deleted: true;
        message: string;
        purpose: typeof MAGIC_LINK_PURPOSE.DELETE_ACCOUNT;
    }> {
        const user = await this.usersService.findByEmail(email);
        if (!user) throw new NotFoundException('User not found');

        await this.usersService.softDelete(user._id.toString());
        await this.revokeAllUserTokens(user._id.toString());
        await this.sendDeletionConfirmationEmail(email);

        return {
            deleted: true,
            message: 'Account scheduled for deletion',
            purpose: MAGIC_LINK_PURPOSE.DELETE_ACCOUNT,
        };
    }

    async checkEmail(
        email: string,
        ip: string
    ): Promise<{ hasPassword: boolean; isNewUser: boolean }> {
        await this.checkEmailRateLimit(ip);

        const normalizedEmail = email.trim().toLowerCase();
        const user = await this.usersService.findByEmail(normalizedEmail);
        return {
            hasPassword: !!user?.passwordHash,
            isNewUser: !user,
        };
    }

    async loginWithPassword(
        email: string,
        password: string,
        ip: string,
        termsVersion?: string
    ): Promise<{
        user: UserDocument;
        accessToken: string;
        refreshToken: string;
        accountDeleted?: boolean;
    }> {
        const normalizedEmail = email.trim().toLowerCase();

        // 1. Check progressive lockout (IP+email)
        await this.checkBruteForce(ip, normalizedEmail);

        // 2. Find user
        const user = await this.usersService.findByEmail(normalizedEmail);
        if (!user || !user.passwordHash) {
            await this.incrementLoginAttempts(ip, normalizedEmail);
            throw new UnauthorizedException('Invalid email or password');
        }

        // 3. Compare password
        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
            await this.incrementLoginAttempts(ip, normalizedEmail);
            throw new UnauthorizedException('Invalid email or password');
        }

        // 4. Clear attempts on success
        await this.clearLoginAttempts(ip, normalizedEmail);

        // 5. Update lastLoginAt + record consent
        user.lastLoginAt = new Date();
        await user.save();

        if (termsVersion) {
            await this.usersService.acceptTerms(
                user._id.toString(),
                termsVersion
            );
        }

        // 6. Generate tokens
        const { accessToken, refreshToken } = await this.generateTokens(
            user._id.toString(),
            user.email
        );

        return {
            user,
            accessToken,
            refreshToken,
            accountDeleted: user.deletedAt ? true : undefined,
        };
    }

    async setPassword(userId: string, password: string): Promise<void> {
        const user = await this.usersService.findById(userId);
        if (!user) throw new NotFoundException('User not found');
        if (user.passwordHash) {
            throw new BadRequestException(
                'Password already set. Use change password instead.'
            );
        }
        const hash = await bcrypt.hash(password, 10);
        await this.usersService.setPasswordHash(userId, hash);
    }

    async changePassword(
        userId: string,
        currentPassword: string,
        newPassword: string
    ): Promise<TokenPair> {
        const user = await this.usersService.findById(userId);
        if (!user || !user.passwordHash) {
            throw new BadRequestException('No password set');
        }
        const isValid = await bcrypt.compare(
            currentPassword,
            user.passwordHash
        );
        if (!isValid) {
            throw new UnauthorizedException('Invalid current password');
        }
        const hash = await bcrypt.hash(newPassword, 10);
        await this.usersService.setPasswordHash(userId, hash);

        // Invalidate all other sessions
        await this.revokeAllUserTokens(userId);

        // Issue new token pair for current session
        return this.generateTokens(userId, user.email);
    }

    async resetPassword(token: string, newPassword: string): Promise<void> {
        const magicKey = `magic:${token}`;
        const raw = await this.redis.getdel(magicKey);

        if (!raw) {
            throw new UnauthorizedException('Invalid or expired reset token');
        }

        const { email, purpose } = JSON.parse(raw) as {
            email: string;
            purpose: MagicLinkPurpose;
        };

        if (purpose !== MAGIC_LINK_PURPOSE.RESET_PASSWORD) {
            throw new BadRequestException('Invalid token purpose');
        }

        const user = await this.usersService.findByEmail(email);
        if (!user) {
            throw new NotFoundException('User not found');
        }

        const hash = await bcrypt.hash(newPassword, 10);
        await this.usersService.setPasswordHash(user._id.toString(), hash);

        await this.revokeAllUserTokens(user._id.toString());
    }

    async verifyPassword(userId: string, password: string): Promise<boolean> {
        const user = await this.usersService.findById(userId);
        if (!user || !user.passwordHash) return false;
        return bcrypt.compare(password, user.passwordHash);
    }

    private async checkEmailRateLimit(ip: string): Promise<void> {
        const key = `check_email:${ip}`;
        // Atomic INCR + sliding-window TTL refresh. The previous GET-then-INCR
        // pattern had two bugs at once: a TOCTOU race that let multiple parallel
        // requests pass the threshold simultaneously, and a non-atomic INCR/EXPIRE
        // pair that could leave the counter without a TTL on process crash. Both
        // are eliminated by checking the post-increment count from a single Lua call.
        const count = await this.redisCounter.incrementSlidingWindow(key, 60);
        if (count > 10) {
            throw new TooManyRequestsException(
                'Too many requests. Try again later'
            );
        }
    }

    private async checkBruteForce(ip: string, email: string): Promise<void> {
        const key = `login_attempts:${ip}:${email}`;
        const attemptsStr = await this.redis.get(key);
        if (!attemptsStr) return;

        const attempts = parseInt(attemptsStr, 10);
        const thresholds = parseLockoutThresholds(ENV.AUTH_LOCKOUT_THRESHOLDS);

        // Find the highest threshold that has been exceeded
        const activeThreshold = [...thresholds]
            .reverse()
            .find((t) => attempts >= t.attempts);

        if (activeThreshold) {
            throw new TooManyRequestsException(
                `Too many login attempts. Try again in ${activeThreshold.blockMin} minutes`
            );
        }
    }

    private async incrementLoginAttempts(
        ip: string,
        email: string
    ): Promise<void> {
        const key = `login_attempts:${ip}:${email}`;
        const ttl = ENV.AUTH_LOGIN_ATTEMPTS_TTL_MIN * 60;
        // Sliding window: every failed attempt refreshes the TTL so an ongoing
        // brute-force keeps the offender locked indefinitely. Atomic Lua avoids
        // the race where a process crash between INCR and EXPIRE leaves the
        // counter without TTL — that would permanently lock out the user.
        await this.redisCounter.incrementSlidingWindow(key, ttl);
    }

    private async clearLoginAttempts(ip: string, email: string): Promise<void> {
        const key = `login_attempts:${ip}:${email}`;
        await this.redis.del(key);
    }

    private async storeRefreshToken(
        userId: string,
        jti: string
    ): Promise<void> {
        const pipeline = this.redis.pipeline();
        pipeline.set(`refresh:${jti}`, userId, 'EX', REFRESH_TOKEN_TTL);
        pipeline.sadd(`refresh_family:${userId}`, jti);
        pipeline.expire(`refresh_family:${userId}`, REFRESH_TOKEN_TTL);
        await pipeline.exec();
    }

    private async revokeRefreshToken(
        jti: string,
        userId: string
    ): Promise<void> {
        const pipeline = this.redis.pipeline();
        pipeline.del(`refresh:${jti}`);
        pipeline.srem(`refresh_family:${userId}`, jti);
        await pipeline.exec();
    }
}

class TooManyRequestsException extends HttpException {
    constructor(message = 'Too many requests. Try again in 15 minutes.') {
        super(message, HttpStatus.TOO_MANY_REQUESTS);
    }
}
