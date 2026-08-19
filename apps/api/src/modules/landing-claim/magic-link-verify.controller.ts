import { Body, Controller, Post, Res } from '@nestjs/common';
import {
    AuthResponse,
    DeleteAccountVerifyResponse,
    LandingClaimResult,
    MAGIC_LINK_PURPOSE,
} from '@finly/types';
import { Response } from 'express';

import { AccountDeletionService } from '../account-deletion/account-deletion.service';
import { AuthService } from '../auth/auth.service';
import { VerifyMagicLinkDto } from '../auth/dto/verify-magic-link.dto';
import {
    clearRefreshCookie,
    setRefreshCookie,
} from '../auth/refresh-cookie.config';
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
        private readonly landingClaimService: LandingClaimService,
        private readonly accountDeletion: AccountDeletionService
    ) {}

    @Post('magic-link/verify')
    async verifyMagicLink(
        @Body() dto: VerifyMagicLinkDto,
        @Res({ passthrough: true }) res: Response
    ): Promise<{ data: AuthResponse | DeleteAccountVerifyResponse }> {
        const result = await this.authService.verifyMagicLink(dto.token);

        if (result.deleted) {
            // Sprint 32 — публічність отримувачів гасне і списання зупиняються
            // рівно тут, на переході за посиланням, а не на натисканні кнопки у
            // кабінеті. Крах між soft-delete і цим кроком добиває фонове
            // прибирання (`CleanupService.resyncDeactivationEffects`), тому
            // збій тут НЕ валить перехід за посиланням: акаунт уже
            // деактивовано, і помилка сказала б людині неправду.
            await this.accountDeletion.applyDeactivationEffectsBestEffort(
                result.userId
            );
            clearRefreshCookie(res);
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

        setRefreshCookie(res, tokens.refreshToken);

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
