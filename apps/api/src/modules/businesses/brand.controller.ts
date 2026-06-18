import {
    Body,
    Controller,
    Delete,
    HttpCode,
    HttpStatus,
    Post,
    UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import {
    BRAND_COMMIT_OUTCOME,
    CommitBrandSchema,
    RequestBrandLogoUploadUrlSchema,
    RESPONSE_CODE,
    type AccessLevel,
    type BrandLogoUploadUrlResponse,
    type BrandPreviewResponse,
    type CommitBrandDto,
    type CommitBrandResponse,
    type RequestBrandLogoUploadUrlDto,
    type ResponseCode,
} from '@finly/types';

import { CurrentAccessLevel } from '../../common/decorators/current-access-level.decorator';
import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import { BusinessAccessGuard, CurrentBusiness } from './business-access.guard';
import { BrandService } from './brand.service';
import type { BusinessDocument } from './schemas/business.schema';

/**
 * Sprint 21 — кабінетні ендпоінти кастомного бренду отримувача. Під зоною
 * власника бізнесу (`JwtActiveGuard` + `BusinessAccessGuard` → `@CurrentBusiness`).
 * Кнопка «Завантажити логотип» видима всім рівням; пейвол лише на commit нижче
 * brand (success-with-state, не throw), дзеркало slug-upsell.
 */
@Controller('businesses/me/:slug/brand')
@UseGuards(JwtActiveGuard, BusinessAccessGuard)
export class BrandController {
    constructor(private readonly brandService: BrandService) {}

    @Post('upload-url')
    @HttpCode(HttpStatus.OK)
    async createUploadUrl(
        @CurrentBusiness() business: BusinessDocument,
        @Body(new ZodValidationPipe(RequestBrandLogoUploadUrlSchema))
        dto: RequestBrandLogoUploadUrlDto
    ): Promise<{ data: BrandLogoUploadUrlResponse }> {
        const data = await this.brandService.createUploadUrl(
            business._id.toString(),
            dto.contentType
        );
        return { data };
    }

    @Post()
    @HttpCode(HttpStatus.OK)
    async commit(
        @CurrentBusiness() business: BusinessDocument,
        @CurrentAccessLevel() actorLevel: AccessLevel,
        @Body(new ZodValidationPipe(CommitBrandSchema)) dto: CommitBrandDto
    ): Promise<{ data: CommitBrandResponse & { code: ResponseCode } }> {
        const result = await this.brandService.commit(
            business,
            dto.fileKey,
            dto.displayName ?? null,
            actorLevel
        );
        const code =
            result.outcome === BRAND_COMMIT_OUTCOME.ACTIVE
                ? RESPONSE_CODE.BRAND_UPDATED
                : RESPONSE_CODE.BRAND_REQUIRES_PLAN;
        return { data: { ...result, code } };
    }

    @Delete()
    @HttpCode(HttpStatus.OK)
    async delete(
        @CurrentBusiness() business: BusinessDocument
    ): Promise<{ data: { code: ResponseCode } }> {
        await this.brandService.delete(business);
        return { data: { code: RESPONSE_CODE.BRAND_DELETED } };
    }

    /**
     * Прев'ю обох QR із наданим логотипом без активації. Доступне всім рівням.
     * Окремий низький бакет `qr-preview` (10/min): кожен виклик робить download +
     * bake + два рендери — важче за звичайний роут. Skip інших named-бакетів,
     * щоб вони не тіньовили поріг (прецедент `slug-availability`).
     */
    @Post('preview')
    @HttpCode(HttpStatus.OK)
    @Throttle({ 'qr-preview': { limit: 10, ttl: 60_000 } })
    @SkipThrottle({
        default: true,
        'public-payment': true,
        'help-chat': true,
        'slug-availability': true,
    })
    async preview(
        @CurrentBusiness() business: BusinessDocument,
        @Body(new ZodValidationPipe(CommitBrandSchema)) dto: CommitBrandDto
    ): Promise<{ data: BrandPreviewResponse }> {
        const data = await this.brandService.preview(
            business,
            dto.fileKey,
            dto.displayName ?? null
        );
        return { data };
    }
}
