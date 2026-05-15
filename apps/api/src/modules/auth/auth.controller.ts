import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Post,
    Req,
    Res,
    UnauthorizedException,
    UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
    AuthResponse,
    CheckEmailResponse,
    DeleteAccountVerifyResponse,
    LandingClaimResult,
    MAGIC_LINK_PURPOSE,
    RESPONSE_CODE,
    type ApiMessageResponse,
} from '@finly/types';
import { CookieOptions, Request, Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import { ENV } from '../../config/env';
import { LandingClaimService } from '../landing-claim/landing-claim.service';
import { UserDocument } from '../users/schemas/user.schema';
import { mapUserToProfileResponse } from '../users/user-profile.mapper';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { CheckEmailDto } from './dto/check-email.dto';
import { LoginPasswordDto } from './dto/login-password.dto';
import { SendMagicLinkDto } from './dto/send-magic-link.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { VerifyMagicLinkDto } from './dto/verify-magic-link.dto';
import { RefreshDto } from './dto/refresh.dto';
import { VerifyPasswordDto } from './dto/verify-password.dto';
import { GoogleValidatedUser } from './strategies/google.strategy';

const REFRESH_COOKIE_OPTIONS: CookieOptions = {
    httpOnly: true,
    secure: ENV.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

@Controller('auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly usersService: UsersService,
        private readonly landingClaimService: LandingClaimService
    ) {}

    @Get('google')
    @UseGuards(AuthGuard('google'))
    @SkipOnboarding()
    googleAuth() {
        // Passport redirects to Google consent screen
    }

    @Get('google/callback')
    @UseGuards(AuthGuard('google'))
    @SkipOnboarding()
    async googleCallback(
        @Req() req: Request,
        @Res() res: Response
    ): Promise<void> {
        const { tokens, accountDeleted } =
            await this.authService.handleGoogleAuth(
                req.user as GoogleValidatedUser
            );

        res.cookie('bid_refresh', tokens.refreshToken, REFRESH_COOKIE_OPTIONS);
        const callbackUrl = accountDeleted
            ? `${ENV.WEB_URL}/auth/callback?account_deleted=true`
            : `${ENV.WEB_URL}/auth/callback`;
        res.redirect(callbackUrl);
    }

    @Post('check-email')
    async checkEmail(
        @Body() dto: CheckEmailDto,
        @Req() req: Request
    ): Promise<{ data: CheckEmailResponse }> {
        const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
        const result = await this.authService.checkEmail(dto.email, ip);
        return { data: result };
    }

    @Post('login/password')
    async loginWithPassword(
        @Body() dto: LoginPasswordDto,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response
    ): Promise<{ data: AuthResponse }> {
        const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
        const { user, accessToken, refreshToken, accountDeleted } =
            await this.authService.loginWithPassword(
                dto.email,
                dto.password,
                ip,
                dto.termsVersion
            );

        res.cookie('bid_refresh', refreshToken, REFRESH_COOKIE_OPTIONS);

        return {
            data: {
                user: mapUserToProfileResponse(user),
                accessToken,
                ...(accountDeleted && { accountDeleted }),
            },
        };
    }

    @Post('magic-link/send')
    async sendMagicLink(
        @Body() dto: SendMagicLinkDto
    ): Promise<ApiMessageResponse> {
        if (dto.purpose === MAGIC_LINK_PURPOSE.DELETE_ACCOUNT) {
            throw new BadRequestException('Invalid purpose');
        }

        await this.authService.sendMagicLink(
            dto.email,
            dto.purpose ?? MAGIC_LINK_PURPOSE.LOGIN,
            dto.redirectTo,
            {
                landingDraft: dto.landingDraft,
                claimIdempotencyKey: dto.claimIdempotencyKey,
                termsVersion: dto.termsVersion,
            }
        );
        return {
            data: {
                code: RESPONSE_CODE.MAGIC_LINK_SENT,
                message: 'Magic link sent',
            },
        };
    }

    @Post('magic-link/verify')
    async verifyMagicLink(
        @Body() dto: VerifyMagicLinkDto,
        @Res({ passthrough: true }) res: Response
    ): Promise<{ data: AuthResponse | DeleteAccountVerifyResponse }> {
        const result = await this.authService.verifyMagicLink(dto.token);

        if (result.deleted) {
            res.clearCookie('bid_refresh', { path: '/' });
            return {
                data: {
                    deleted: true,
                    purpose: MAGIC_LINK_PURPOSE.DELETE_ACCOUNT,
                    message: result.message,
                },
            };
        }

        const { user, tokens, purpose, accountDeleted, rawPayload } = result;

        // Sprint 13 §13 — orchestration. Invariant "stamp ДО claim" (Sprint 10
        // §SP-12: terms-pre-stamp закриває acceptTerms ordering window — без
        // нього frontend `acceptTerms()` post-claim throw на network glitch
        // лишав би Business+Account без terms-stamp).
        if (rawPayload.termsVersion) {
            await this.usersService.stampAcceptedTerms(
                user._id.toString(),
                rawPayload.termsVersion
            );
        }

        let claim: LandingClaimResult | null = null;
        if (rawPayload.landingDraft && rawPayload.claimIdempotencyKey) {
            claim = await this.landingClaimService.attemptLandingClaim(
                {
                    userId: user._id.toString(),
                    isBookkeeperMode: user.worksAsBookkeeper ?? false,
                },
                rawPayload.landingDraft,
                rawPayload.claimIdempotencyKey
            );
        }

        res.cookie('bid_refresh', tokens.refreshToken, REFRESH_COOKIE_OPTIONS);

        return {
            data: {
                user: mapUserToProfileResponse(user),
                accessToken: tokens.accessToken,
                purpose,
                ...(accountDeleted && { accountDeleted }),
                claim,
            },
        };
    }

    @Post('password/reset')
    async resetPassword(
        @Body() dto: ResetPasswordDto
    ): Promise<ApiMessageResponse> {
        await this.authService.resetPassword(dto.token, dto.newPassword);
        return {
            data: {
                code: RESPONSE_CODE.PASSWORD_RESET,
                message: 'Password has been reset',
            },
        };
    }

    @Post('password/set')
    @UseGuards(JwtActiveGuard)
    @SkipOnboarding()
    async setPassword(
        @CurrentUser() user: UserDocument,
        @Body() dto: SetPasswordDto
    ): Promise<ApiMessageResponse> {
        await this.authService.setPassword(user._id.toString(), dto.password);
        return {
            data: {
                code: RESPONSE_CODE.PASSWORD_SET,
                message: 'Password set',
            },
        };
    }

    @Post('password/change')
    @UseGuards(JwtActiveGuard)
    @SkipOnboarding()
    async changePassword(
        @CurrentUser() user: UserDocument,
        @Body() dto: ChangePasswordDto,
        @Res({ passthrough: true }) res: Response
    ): Promise<{ data: { message: string; accessToken: string } }> {
        const { accessToken, refreshToken } =
            await this.authService.changePassword(
                user._id.toString(),
                dto.currentPassword,
                dto.newPassword
            );

        res.cookie('bid_refresh', refreshToken, REFRESH_COOKIE_OPTIONS);

        return { data: { message: 'Password changed', accessToken } };
    }

    @Post('password/verify')
    @UseGuards(JwtActiveGuard)
    @SkipOnboarding()
    async verifyPassword(
        @CurrentUser() user: UserDocument,
        @Body() dto: VerifyPasswordDto
    ): Promise<{ data: { isValid: boolean } }> {
        const isValid = await this.authService.verifyPassword(
            user._id.toString(),
            dto.password
        );
        return { data: { isValid } };
    }

    @Post('refresh')
    async refresh(
        @Body() dto: RefreshDto,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response
    ): Promise<{ data: { accessToken: string } }> {
        const refreshToken = req.cookies?.bid_refresh as string | undefined;

        if (!refreshToken) {
            throw new UnauthorizedException('Refresh token not found');
        }

        try {
            const tokens = await this.authService.rotateRefreshToken(
                refreshToken,
                dto.timezone
            );

            res.cookie(
                'bid_refresh',
                tokens.refreshToken,
                REFRESH_COOKIE_OPTIONS
            );

            return { data: { accessToken: tokens.accessToken } };
        } catch (error) {
            res.clearCookie('bid_refresh', {
                httpOnly: true,
                secure: ENV.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
            });
            throw error;
        }
    }

    @Post('logout')
    async logout(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response
    ): Promise<ApiMessageResponse> {
        const refreshToken = req.cookies?.bid_refresh as string | undefined;

        if (refreshToken) {
            await this.authService.revokeRefreshTokenByJwt(refreshToken);
        }

        res.clearCookie('bid_refresh', {
            httpOnly: true,
            secure: ENV.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
        });

        return {
            data: {
                code: RESPONSE_CODE.LOGGED_OUT,
                message: 'Logged out',
            },
        };
    }
}
