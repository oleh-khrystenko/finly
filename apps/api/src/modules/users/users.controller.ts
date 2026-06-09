import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Patch,
    Post,
    Res,
    UnauthorizedException,
    UseGuards,
} from '@nestjs/common';
import {
    MAGIC_LINK_PURPOSE,
    RESPONSE_CODE,
    type ApiMessageResponse,
} from '@finly/types';
import { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthService } from '../auth/auth.service';
import { VerifyPasswordDto } from '../auth/dto/verify-password.dto';
import { AcceptTermsDto } from './dto/accept-terms.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserDocument } from './schemas/user.schema';
import { mapUserToProfileResponse } from './user-profile.mapper';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
    constructor(
        private readonly usersService: UsersService,
        private readonly authService: AuthService
    ) {}

    @Get('me')
    @UseGuards(JwtActiveGuard)
    @SkipOnboarding()
    getMe(@CurrentUser() user: UserDocument): {
        data: Record<string, unknown>;
    } {
        return { data: mapUserToProfileResponse(user) };
    }

    @Patch('me')
    @UseGuards(JwtActiveGuard)
    @SkipOnboarding()
    async updateProfile(
        @CurrentUser() user: UserDocument,
        @Body() dto: UpdateProfileDto
    ): Promise<{ data: Record<string, unknown> }> {
        const userId = user._id.toString();
        // Sprint 11 — explicit clear-action для backend-stamped redirect-target.
        // DTO дозволяє лише `null`; стемп робиться backend-only через
        // `UsersService.setPendingPostLoginTarget` (не через цей endpoint).
        const { pendingPostLoginTarget, ...profileDto } = dto;
        if (pendingPostLoginTarget === null) {
            await this.usersService.clearPendingPostLoginTarget(userId);
        }
        const updated = await this.usersService.updateProfile(
            userId,
            profileDto
        );
        return { data: mapUserToProfileResponse(updated!) };
    }

    @Post('me/accept-terms')
    @UseGuards(JwtActiveGuard)
    @SkipOnboarding()
    async acceptTerms(
        @CurrentUser() user: UserDocument,
        @Body() dto: AcceptTermsDto
    ): Promise<ApiMessageResponse> {
        await this.usersService.acceptTerms(
            user._id.toString(),
            dto.termsVersion
        );
        return {
            data: {
                code: RESPONSE_CODE.TERMS_ACCEPTED,
                message: 'Terms accepted',
            },
        };
    }

    @Post('account/delete')
    @UseGuards(JwtActiveGuard)
    @SkipOnboarding()
    async deleteAccount(
        @CurrentUser() user: UserDocument
    ): Promise<{ data: Record<string, unknown> }> {
        if (user.passwordHash) {
            return { data: { requiresPassword: true } };
        }
        await this.authService.sendMagicLink(
            user.email,
            MAGIC_LINK_PURPOSE.DELETE_ACCOUNT
        );
        await this.usersService.setDeletionRequested(user._id.toString());
        return {
            data: {
                requiresMagicLink: true,
                message: 'Confirmation link sent',
            },
        };
    }

    @Post('account/delete/confirm')
    @UseGuards(JwtActiveGuard)
    @SkipOnboarding()
    async confirmDeleteAccount(
        @CurrentUser() user: UserDocument,
        @Body() dto: VerifyPasswordDto,
        @Res({ passthrough: true }) res: Response
    ): Promise<ApiMessageResponse> {
        const isValid = await this.authService.verifyPassword(
            user._id.toString(),
            dto.password
        );
        if (!isValid) {
            throw new UnauthorizedException('Invalid password');
        }

        await this.usersService.softDelete(user._id.toString());
        await this.authService.revokeAllUserTokens(user._id.toString());
        await this.authService.sendDeletionConfirmationEmail(user.email);

        res.clearCookie('bid_refresh', { path: '/' });

        return {
            data: {
                code: RESPONSE_CODE.ACCOUNT_DELETED,
                message: 'Account scheduled for deletion',
            },
        };
    }

    @Post('account/restore')
    @UseGuards(JwtAuthGuard)
    async restoreAccount(
        @CurrentUser() user: UserDocument
    ): Promise<ApiMessageResponse> {
        if (!user.deletedAt) {
            throw new BadRequestException('Account is not deleted');
        }
        await this.usersService.restore(user._id.toString());
        return {
            data: {
                code: RESPONSE_CODE.ACCOUNT_RESTORED,
                message: 'Account restored',
            },
        };
    }
}
