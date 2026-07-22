import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    UseGuards,
} from '@nestjs/common';

import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import { BusinessesService } from '../businesses/businesses.service';
import type { BusinessDocument } from '../businesses/schemas/business.schema';
import { ApprovePublicityDto } from './dto/approve-publicity.dto';
import { RejectPublicityDto } from './dto/reject-publicity.dto';

/**
 * Sprint 29 — адмінська черга запитів на публічність. На відміну від
 * `AdminPayeesController` (створення системних отримувачів), тут адмін розглядає
 * запити ЗВИЧАЙНИХ бізнесів користувачів: схвалює (з чистим скиданням видимості)
 * або відхиляє з причиною. Guard-chain на класі — жоден роут поза перевіркою ролі.
 */
@Controller('admin/publicity')
@UseGuards(JwtActiveGuard, AdminGuard)
@SkipOnboarding()
export class AdminPublicityController {
    constructor(private readonly businessesService: BusinessesService) {}

    @Get()
    async queue(): Promise<{ data: BusinessDocument[] }> {
        const data = await this.businessesService.listPublicityQueue();
        return { data };
    }

    /**
     * Схвалені отримувачі у каталозі: адмін бачить, кого впустив, і може забрати
     * схвалення тим самим `reject`-роутом (миттєвий важіль проти недоброчесного
     * запису, який план називає головним ризиком каталогу).
     */
    @Get('approved')
    async approved(): Promise<{ data: BusinessDocument[] }> {
        const data = await this.businessesService.listApprovedPublicity();
        return { data };
    }

    @Post(':slug/approve')
    @HttpCode(HttpStatus.OK)
    async approve(
        @Param('slug') slug: string,
        @Body() dto: ApprovePublicityDto
    ): Promise<{ data: BusinessDocument }> {
        const business = await this.businessesService.approvePublicity(
            slug,
            dto.category
        );
        return { data: business };
    }

    @Post(':slug/reject')
    @HttpCode(HttpStatus.OK)
    async reject(
        @Param('slug') slug: string,
        @Body() dto: RejectPublicityDto
    ): Promise<{ data: BusinessDocument }> {
        const business = await this.businessesService.rejectPublicity(
            slug,
            dto.reason
        );
        return { data: business };
    }
}
