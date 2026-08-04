import { Controller, Get, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { type PayerSource } from '@finly/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import { skipThrottlersExcept } from '../../common/http/throttle-policy';
import type { UserDocument } from '../users/schemas/user.schema';
import { BusinessesService } from './businesses.service';

/**
 * Sprint 30 — отримувачі користувача, придатні як джерело даних платника на
 * податковій сторінці. Читає лише `Business`, тому живе у `BusinessesModule`
 * поруч з даними, а не у `PayersModule`: зворотне ребро `Payers → Businesses`
 * замкнуло б цикл `Businesses → Users → Payers → Businesses`.
 *
 * **Власний префікс, а не `businesses/me/...`** — під ним уже висить
 * параметричний `me/:slug`, і будь-який статичний сусід перетворився б на
 * приховано зарезервований slug: отримувач з такою адресою відкривався б у
 * кабінеті не своєю сторінкою.
 *
 * `@SkipOnboarding` — з тієї ж причини, що у `PayersController`: ендпоінт
 * викликається з платіжної сторінки, де відповідь `ONBOARDING_INCOMPLETE`
 * означала б помилку посеред оплати.
 */
@Controller('payer-sources')
@UseGuards(JwtActiveGuard)
@SkipOnboarding()
// Кабінет за логіном: throttle вимкнено повністю (див. BusinessesController).
@SkipThrottle(skipThrottlersExcept())
export class PayerSourcesController {
    constructor(private readonly businessesService: BusinessesService) {}

    @Get()
    async list(
        @CurrentUser() user: UserDocument
    ): Promise<{ data: PayerSource[] }> {
        const data = await this.businessesService.listPayerSources(
            user._id.toString()
        );
        return { data };
    }
}
