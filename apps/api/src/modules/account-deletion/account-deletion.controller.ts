import {
    BadRequestException,
    Body,
    ConflictException,
    Controller,
    Get,
    Post,
    Res,
    UnauthorizedException,
    UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
    MAGIC_LINK_PURPOSE,
    RESPONSE_CODE,
    type AccountDeletionPreview,
    type ApiMessageResponse,
} from '@finly/types';
import { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { skipThrottlersExcept } from '../../common/http/throttle-policy';
import { AuthService } from '../auth/auth.service';
import { VerifyPasswordDto } from '../auth/dto/verify-password.dto';
import { clearRefreshCookie } from '../auth/refresh-cookie.config';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { AccountDeletionService } from './account-deletion.service';

/**
 * Sprint 32 — життєвий цикл видалення акаунта повністю. Контролер живе тут, а
 * не в `UsersModule`, бо кожен його крок торкається отримувачів, а ребро
 * `Users → Businesses` зламало б one-way DAG (той самий мотив, що у
 * `MagicLinkVerifyController` з `LandingClaimModule`). Префікс лишається
 * `users/account/…` — адреси не змінюються.
 *
 * Порядок кроків: перелік → вписані кількості → підтвердження. Саме натискання
 * «Видалити акаунт» не змінює нічого, крім надісланого листа: до відкритого
 * ноутбука підходить хто завгодно, а до чужого акаунта залазить той, у кого
 * немає доступу до пошти.
 */
@Controller('users')
// Кабінет за логіном: throttle вимкнено повністю (див. BusinessesController).
@SkipThrottle(skipThrottlersExcept())
export class AccountDeletionController {
    constructor(
        private readonly usersService: UsersService,
        private readonly authService: AuthService,
        private readonly accountDeletion: AccountDeletionService
    ) {}

    /**
     * Перелік того, що зникне разом з акаунтом, плюс шлях підтвердження. Доступний
     * і при незаповненому профілі, як решта дій з акаунтом.
     */
    @Get('account/delete/preview')
    @UseGuards(JwtActiveGuard)
    @SkipOnboarding()
    async getDeletionPreview(
        @CurrentUser() user: UserDocument
    ): Promise<{ data: AccountDeletionPreview }> {
        const preview = await this.accountDeletion.getPreview(
            user._id.toString(),
            user.passwordHash ? 'password' : 'email'
        );
        return { data: preview };
    }

    /**
     * Почати видалення. Розвилка та сама: у кого є пароль — підтверджує ним (тут
     * не відбувається нічого), у кого немає — отримує разове посилання.
     * Позначка `accountDeletionRequestedAt` лишається технічним слідом
     * надсилання і наслідків для отримувачів не має жодних.
     */
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
        const userId = user._id.toString();
        const isValid = await this.authService.verifyPassword(
            userId,
            dto.password
        );
        if (!isValid) {
            throw new UnauthorizedException('Invalid password');
        }

        await this.usersService.softDelete(userId);
        // Публічність гасне і списання зупиняються рівно тут — у момент
        // підтвердження, а не на натисканні кнопки. Крах між soft-delete і цим
        // кроком добиває фонове прибирання (`resyncDeactivationEffects`), тому
        // збій тут НЕ валить запит: акаунт уже деактивовано, а попереду ще
        // відкликання сесій, лист і очищення cookie — обірвати їх означало б
        // лишити людині живу сесію і показати помилку про невдале видалення,
        // якого насправді не було.
        await this.accountDeletion.applyDeactivationEffectsBestEffort(userId);
        await this.authService.revokeAllUserTokens(userId);
        await this.authService.sendDeletionConfirmationEmail(user.email);

        clearRefreshCookie(res);

        return {
            data: {
                code: RESPONSE_CODE.ACCOUNT_DELETED,
                message: 'Account scheduled for deletion',
            },
        };
    }

    /**
     * `@SkipOnboarding()` обов'язковий і симетричний до кроків видалення вище:
     * видалити акаунт можна з незаповненим профілем, тож і повернути його теж
     * мусить бути можна. Без цієї позначки людина, яка зареєструвалась через
     * лист і не вписала ім'я, впиралась би у «заповніть профіль» — а заповнити
     * його ніде, бо кабінет деактивованому закритий.
     */
    @Post('account/restore')
    @UseGuards(JwtAuthGuard)
    @SkipOnboarding()
    async restoreAccount(
        @CurrentUser() user: UserDocument
    ): Promise<ApiMessageResponse> {
        if (!user.deletedAt) {
            throw new BadRequestException('Account is not deleted');
        }
        const userId = user._id.toString();
        // Гонка з фоновим прибиранням розв'язується у самому записі: якщо воно
        // вже взялось за акаунт, отримувачі знесені, і знімати деактивацію
        // означало б повернути людину у живий, але порожній кабінет.
        const restored = await this.usersService.restore(userId);
        if (!restored) {
            throw new ConflictException({
                code: RESPONSE_CODE.ACCOUNT_PURGE_IN_PROGRESS,
                message: 'Account purge already started',
            });
        }
        // Людина повертається у стан, у якому була до натискання кнопки: сторінки
        // відкриваються, планувальник підхоплює платника з тією самою карткою і
        // тим самим оплаченим періодом.
        await this.accountDeletion.revertDeactivationEffects(userId);
        return {
            data: {
                code: RESPONSE_CODE.ACCOUNT_RESTORED,
                message: 'Account restored',
            },
        };
    }
}
