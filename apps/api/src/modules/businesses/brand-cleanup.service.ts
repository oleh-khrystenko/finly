import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';

import { ENV } from '../../config/env';
import { StorageService } from '../storage/storage.service';
import { Business, type BusinessDocument } from './schemas/business.schema';

const MS_PER_DAY = 86_400_000;

interface StalePendingBrand {
    _id: Types.ObjectId;
    brand: {
        pending: {
            logoUrl: string;
            centerMarkUrl: string;
            bandMarkUrl: string;
            uploadedAt: Date;
        } | null;
    } | null;
}

/**
 * Sprint 21 — cron-чистка orphan pending-логотипів бренду.
 *
 * Прибирає `brand.pending`, що пролежав без оплати довше за
 * `BRAND_PENDING_CLEANUP_DAYS`: ніколи-неоплачені free-завантаження + демоутовані
 * після згасання тарифу (їм реконсиляція дала свіже `uploadedAt`-вікно). Повторна
 * підписка у межах вікна промотує pending назад в active (реконсиляція), тож сюди
 * він уже не потрапляє.
 *
 * Claim-first: `updateOne` зі stale-фільтром гасить слот лише якщо він ще stale —
 * захист від гонки з промоцією (re-subscribe між скануванням і записом лишає
 * pending=null, ми його не чіпаємо й файли не видаляємо, бо вони тепер в active).
 */
@Injectable()
export class BrandCleanupService {
    private readonly logger = new Logger(BrandCleanupService.name);

    constructor(
        @InjectModel(Business.name)
        private readonly businessModel: Model<BusinessDocument>,
        private readonly storage: StorageService
    ) {}

    @Cron('0 4 * * *', { timeZone: 'Europe/Kyiv' })
    async runDailyCleanup(): Promise<void> {
        const now = Date.now();
        const freeCutoff = new Date(
            now - ENV.BRAND_PENDING_CLEANUP_DAYS * MS_PER_DAY
        );
        const demotedCutoff = new Date(
            now - ENV.BRAND_DEMOTED_CLEANUP_DAYS * MS_PER_DAY
        );

        // Два бакети з різними порогами: free-завантаження (`demoted !== true` —
        // охоплює false і legacy-відсутнє) за коротким, демоутований платний
        // (`demoted: true`) за довгим. `$ne: true` критичний — без нього
        // legacy-pending без поля ніколи б не чистився.
        const staleFilter = {
            $or: [
                {
                    'brand.pending.demoted': { $ne: true },
                    'brand.pending.uploadedAt': { $lt: freeCutoff },
                },
                {
                    'brand.pending.demoted': true,
                    'brand.pending.uploadedAt': { $lt: demotedCutoff },
                },
            ],
        };

        const stale = await this.businessModel
            .find(staleFilter, { 'brand.pending': 1 })
            .lean<StalePendingBrand[]>()
            .exec();

        if (stale.length === 0) {
            this.logger.log('Brand pending cleanup: no candidates');
            return;
        }

        let cleaned = 0;
        for (const biz of stale) {
            const pending = biz.brand?.pending;
            if (!pending) continue;
            try {
                // Claim-first: гасимо лише якщо слот усе ще stale за тим самим
                // правилом (не промотований конкурентною реконсиляцією між find
                // і цим записом).
                const res = await this.businessModel
                    .updateOne(
                        { _id: biz._id, ...staleFilter },
                        { $set: { 'brand.pending': null } }
                    )
                    .exec();
                if (res.modifiedCount === 0) continue;

                // Файли видаляємо ПІСЛЯ зняття DB-посилання (best-effort).
                await this.storage.safeDeleteByUrl(pending.logoUrl);
                await this.storage.safeDeleteByUrl(pending.centerMarkUrl);
                await this.storage.safeDeleteByUrl(pending.bandMarkUrl);
                cleaned++;
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : String(err);
                this.logger.error(
                    `Brand pending cleanup failed for business ${biz._id.toString()}: ${message}. ` +
                        'Continuing with remaining candidates.'
                );
            }
        }

        this.logger.log(
            `Brand pending cleanup: candidates=${stale.length} cleaned=${cleaned}`
        );
    }
}
