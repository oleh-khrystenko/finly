import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
    RESPONSE_CODE,
    type PublicGuideView,
    type PublicGuidesTree,
} from '@finly/types';

import { GuidesService } from './guides.service';

/**
 * Sprint 28 — публічні read-ендпоінти розділу гайдів (тільки published).
 * Споживач — server-side fetch web-у (сторінки, sitemap, OG), тож для API
 * багато клієнтів виглядають одним IP: власний content-бакет з високим
 * лімітом, як у public-payment (та сама NAT/proxy специфіка).
 */
@Controller('guides/public')
@Throttle({ 'public-content': { limit: 600, ttl: 60_000 } })
@SkipThrottle({ default: true })
export class GuidesPublicController {
    constructor(private readonly guidesService: GuidesService) {}

    @Get()
    async tree(): Promise<{ data: PublicGuidesTree }> {
        const data = await this.guidesService.getPublicTree();
        return { data };
    }

    // Двосегментний шлях навмисно: одно-сегментний `slugs` перехоплювався б
    // параметричним `:slug` нижче (і навпаки — гайд зі slug `slugs` став би
    // недосяжним, а `/guides/slugs` віддавав би масив замість статті).
    @Get('sitemap/slugs')
    async slugs(): Promise<{ data: string[] }> {
        const data = await this.guidesService.getPublishedSlugs();
        return { data };
    }

    @Get(':slug')
    async view(
        @Param('slug') slug: string
    ): Promise<{ data: PublicGuideView }> {
        const view = await this.guidesService.getPublicView(slug);
        if (!view) {
            throw new NotFoundException({
                code: RESPONSE_CODE.GUIDE_NOT_FOUND,
                message: 'Guide not found',
            });
        }
        return { data: view };
    }
}
