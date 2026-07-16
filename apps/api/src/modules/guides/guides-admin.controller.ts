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
import {
    type AdminGuideListItem,
    type CommitGuideImageResponse,
    type GuideImageUploadUrlResponse,
} from '@finly/types';

import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import { CommitGuideImageDto } from './dto/commit-guide-image.dto';
import { UpsertGuideDto } from './dto/upsert-guide.dto';
import { GuideImagesService } from './guide-images.service';
import { GuidesService } from './guides.service';
import type { GuideDocument } from './schemas/guide.schema';

/**
 * Sprint 28 — адмін-CRUD гайдів. Перша адмін-поверхня: guard-chain
 * JwtActiveGuard (auth + soft-delete) → AdminGuard (role) на класі — жоден
 * роут не існує поза перевіркою ролі.
 *
 * `@SkipOnboarding` — це staff-інструмент керування контентом, не пов'язаний
 * з FOP-онбордингом клієнта; глобальний OnboardingInterceptor інакше блокував
 * би адміна з незаповненим профілем (як payments/catalog і users/me).
 */
@Controller('admin/guides')
@UseGuards(JwtActiveGuard, AdminGuard)
@SkipOnboarding()
export class GuidesAdminController {
    constructor(
        private readonly guidesService: GuidesService,
        private readonly guideImagesService: GuideImagesService
    ) {}

    @Get()
    async list(): Promise<{ data: AdminGuideListItem[] }> {
        const data = await this.guidesService.adminList();
        return { data };
    }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    async create(
        @Body() dto: UpsertGuideDto
    ): Promise<{ data: GuideDocument }> {
        const guide = await this.guidesService.create(dto);
        return { data: guide };
    }

    @Post('images/upload-url')
    async createImageUploadUrl(): Promise<{
        data: GuideImageUploadUrlResponse;
    }> {
        const data = await this.guideImagesService.createUploadUrl();
        return { data };
    }

    @Post('images/commit')
    @HttpCode(HttpStatus.OK)
    async commitImageUpload(
        @Body() dto: CommitGuideImageDto
    ): Promise<{ data: CommitGuideImageResponse }> {
        const url = await this.guideImagesService.commitUpload(dto.fileKey);
        return { data: { url } };
    }

    @Get(':id')
    async getOne(@Param('id') id: string): Promise<{ data: GuideDocument }> {
        const guide = await this.guidesService.adminGetById(id);
        return { data: guide };
    }

    @Patch(':id')
    async update(
        @Param('id') id: string,
        @Body() dto: UpsertGuideDto
    ): Promise<{ data: GuideDocument }> {
        const guide = await this.guidesService.update(id, dto);
        return { data: guide };
    }

    @Post(':id/publish')
    @HttpCode(HttpStatus.OK)
    async publish(@Param('id') id: string): Promise<{ data: GuideDocument }> {
        const guide = await this.guidesService.publish(id);
        return { data: guide };
    }

    @Post(':id/unpublish')
    @HttpCode(HttpStatus.OK)
    async unpublish(@Param('id') id: string): Promise<{ data: GuideDocument }> {
        const guide = await this.guidesService.unpublish(id);
        return { data: guide };
    }

    @Delete(':id')
    @HttpCode(HttpStatus.OK)
    async delete(@Param('id') id: string): Promise<{ data: { id: string } }> {
        await this.guidesService.delete(id);
        return { data: { id } };
    }
}
