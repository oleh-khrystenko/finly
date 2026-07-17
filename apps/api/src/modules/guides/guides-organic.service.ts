import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import type { SyncOrganicResult } from '@finly/types';

import { ENV } from '../../config/env';
import {
    GoogleSearchConsoleClient,
    normalizeUrl,
} from './google-search-console.client';
import { Guide, GuideDocument } from './schemas/guide.schema';

const WINDOW_DAYS = 28;
const MS_PER_DAY = 86_400_000;

/** YYYY-MM-DD у київському часі — та сама конвенція, що й дати гайдів. */
function kyivDate(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(
        d
    );
}

/**
 * Синхронізація органічних кліків гайдів із Google Search Console.
 *
 * Один запит тягне кліки по всіх сторінках за останні 28 днів, далі кожному
 * опублікованому гайду проставляється число за збігом його публічного URL
 * (`WEB_URL/guides/{slug}`). Дані GSC відстають на ~2 дні — це нормально,
 * показуємо суму за вікно, а не «сьогодні».
 */
@Injectable()
export class GuidesOrganicService {
    private readonly logger = new Logger(GuidesOrganicService.name);

    constructor(
        @InjectModel(Guide.name)
        private readonly guideModel: Model<GuideDocument>,
        private readonly gsc: GoogleSearchConsoleClient
    ) {}

    // Раз на добу о 06:00 за Києвом (після нічного оновлення даних у GSC).
    @Cron('0 6 * * *', { timeZone: 'Europe/Kyiv' })
    async runDailySync(): Promise<void> {
        try {
            const result = await this.syncNow();
            this.logger.log(
                `Органіка синкнута: ${result.updated} статей, ${result.totalClicks} кліків`
            );
        } catch (err) {
            // Cron не має валити застосунок: лог і чекаємо наступного запуску.
            this.logger.error(
                `Синк органіки впав: ${
                    err instanceof Error ? err.message : String(err)
                }`
            );
        }
    }

    async syncNow(): Promise<SyncOrganicResult> {
        const now = new Date();
        const startDate = kyivDate(
            new Date(now.getTime() - WINDOW_DAYS * MS_PER_DAY)
        );
        const endDate = kyivDate(now);

        const clicksByUrl = await this.gsc.fetchPageClicks(startDate, endDate);

        const published = await this.guideModel
            .find({ status: 'published' })
            .exec();

        let totalClicks = 0;
        for (const guide of published) {
            const url = normalizeUrl(`${ENV.WEB_URL}/guides/${guide.slug}`);
            const clicks = clicksByUrl.get(url) ?? 0;
            guide.organicClicks = clicks;
            guide.organicSyncedAt = now;
            // `timestamps: false` — синк органіки не є редагуванням контенту,
            // тож не бампаємо `updatedAt` (інакше адмінська колонка «Оновлено»
            // щодоби показувала б дату синку замість останньої правки статті).
            await guide.save({ timestamps: false });
            totalClicks += clicks;
        }

        return { updated: published.length, totalClicks };
    }
}
