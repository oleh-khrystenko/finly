import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { type PayerView } from '@finly/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import { skipThrottlersExcept } from '../../common/http/throttle-policy';
import { UserDocument } from '../users/schemas/user.schema';
import { CreatePayerDto } from './dto/create-payer.dto';
import { UpdatePayerDto } from './dto/update-payer.dto';
import { PayersService } from './payers.service';

/**
 * Sprint 30 — список платників користувача. Кабінетна зона за логіном; ті самі
 * роути обслуговують і податкову сторінку на pay-хості (спільна сесія, той
 * самий origin через rewrite web-контейнера), тому окремої публічної поверхні
 * для персональних даних не існує.
 *
 * `@SkipOnboarding` — список не пов'язаний з онбордингом ФОПа: людина може
 * зареєструватись заради оплати податків і не заводити жодного отримувача.
 * Без цього глобальний інтерцептор віддавав би `ONBOARDING_INCOMPLETE` прямо
 * посеред платіжної сторінки.
 */
@Controller('payers')
@UseGuards(JwtActiveGuard)
@SkipOnboarding()
// Кабінет за логіном: throttle вимкнено повністю (див. BusinessesController).
@SkipThrottle(skipThrottlersExcept())
export class PayersController {
    constructor(private readonly payersService: PayersService) {}

    @Get()
    async list(
        @CurrentUser() user: UserDocument
    ): Promise<{ data: PayerView[] }> {
        const data = await this.payersService.list(user._id);
        return { data };
    }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    async create(
        @CurrentUser() user: UserDocument,
        @Body() dto: CreatePayerDto
    ): Promise<{ data: PayerView }> {
        const data = await this.payersService.create(user._id, dto);
        return { data };
    }

    @Patch(':id')
    async update(
        @CurrentUser() user: UserDocument,
        @Param('id') id: string,
        @Body() dto: UpdatePayerDto
    ): Promise<{ data: PayerView }> {
        const data = await this.payersService.update(user._id, id, dto);
        return { data };
    }

    @Delete(':id')
    @HttpCode(HttpStatus.OK)
    async delete(
        @CurrentUser() user: UserDocument,
        @Param('id') id: string
    ): Promise<{ data: { id: string } }> {
        await this.payersService.delete(user._id, id);
        return { data: { id } };
    }
}
