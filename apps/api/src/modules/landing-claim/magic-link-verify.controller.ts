import { Body, Controller, Post, Res } from '@nestjs/common';
import {
    AuthResponse,
    DeleteAccountVerifyResponse,
    LandingClaimResult,
    MAGIC_LINK_PURPOSE,
} from '@finly/types';
import { Response } from 'express';

import { AuthService } from '../auth/auth.service';
import { VerifyMagicLinkDto } from '../auth/dto/verify-magic-link.dto';
import { REFRESH_COOKIE_OPTIONS } from '../auth/refresh-cookie.config';
import { mapUserToProfileResponse } from '../users/user-profile.mapper';
import { UsersService } from '../users/users.service';
import { LandingClaimService } from './landing-claim.service';

/**
 * Sprint 13 §13 — резидент LandingClaimModule. AuthModule більше не імпортує
 * LandingClaimModule (інакше CJS-evaluation ланцюг `accounts → businesses →
 * users → auth → landing-claim → businesses` повертає partial-undefined через
 * незавершений decoration сусідньої class-declaration). Тут оркеструється
 * magic-link verify: validate token → stamp accepted terms → optional anon
 * claim → склеїти response.
 *
 * Інваріант "stamp ДО claim" (Sprint 10 §SP-12) живе явним порядком викликів.
 */
@Controller('auth')
export class MagicLinkVerifyController {
    constructor(
        private readonly authService: AuthService,
        private readonly usersService: UsersService,
        private readonly landingClaimService: LandingClaimService
    ) {}

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
}
