import {
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Patch,
    Post,
    Query,
    Res,
    UnauthorizedException,
    UseGuards,
} from '@nestjs/common';
import {
    EXECUTION_ACTION_COST,
    MAGIC_LINK_PURPOSE,
    RESPONSE_CODE,
    type ExecutionTransactionItem,
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
import { SpendExecutionsDto } from './dto/spend-executions.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import type {
    ExecutionTransactionDocument,
    ExecutionTransactionLean,
} from './schemas/execution-transaction.schema';
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
        const updated = await this.usersService.updateProfile(
            user._id.toString(),
            dto
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

    @Post('me/executions/spend')
    @UseGuards(JwtActiveGuard)
    @HttpCode(HttpStatus.OK)
    async spendExecutions(
        @CurrentUser() user: UserDocument,
        @Body() dto: SpendExecutionsDto
    ): Promise<{
        data: { balance: number; transaction: ExecutionTransactionItem };
    }> {
        const cost = EXECUTION_ACTION_COST[dto.action];
        const result = await this.usersService.spendExecutions(
            user._id.toString(),
            cost,
            dto.action
        );

        if (!result) {
            throw new BadRequestException({
                code: RESPONSE_CODE.INSUFFICIENT_EXECUTIONS,
                message: 'Insufficient executions',
            });
        }

        return {
            data: {
                balance: result.balanceAfter,
                transaction: this.mapTransaction(result.transaction),
            },
        };
    }

    @Get('me/executions/transactions')
    @UseGuards(JwtActiveGuard)
    async getExecutionTransactions(
        @CurrentUser() user: UserDocument,
        @Query('limit') limitParam?: string,
        @Query('before') beforeParam?: string
    ): Promise<{
        data: { items: ExecutionTransactionItem[]; hasMore: boolean };
    }> {
        const limit = Math.min(
            Math.max(parseInt(limitParam || '10', 10) || 10, 1),
            50
        );
        const before = beforeParam ? new Date(beforeParam) : undefined;
        if (before && isNaN(before.getTime())) {
            return { data: { items: [], hasMore: false } };
        }

        const { items, hasMore } =
            await this.usersService.getRecentTransactions(
                user._id.toString(),
                limit,
                before
            );

        return {
            data: {
                items: items.map((t) => this.mapTransaction(t)),
                hasMore,
            },
        };
    }

    private mapTransaction(
        t: ExecutionTransactionLean | ExecutionTransactionDocument
    ): ExecutionTransactionItem {
        return {
            id: t._id.toString(),
            type: t.type as 'credit' | 'debit',
            action: t.action,
            amount: t.amount,
            balanceAfter: t.balanceAfter,
            createdAt: t.createdAt,
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
