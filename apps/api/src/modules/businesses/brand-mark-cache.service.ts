import { Injectable, Logger } from '@nestjs/common';

import { StorageService } from '../storage/storage.service';
import type { BusinessDocument } from './schemas/business.schema';

/**
 * Sprint 21 — резолвер байтів АКТИВНОЇ бренд-марки для публічного QR-рендеру.
 *
 * **Гейтинг на рендері = довіра активному слоту.** Публічний анонімний рендер
 * НЕ резолвить entitlement наживо: він рендерить кастомну марку тоді й лише тоді,
 * коли заповнений `brand.active` (ніколи `pending`). Актуальність слота тримає
 * реконсиляція (Блок 4): втрата доступу демоутить active→pending, тож «нижче
 * brand → Finly» виконується автоматично без білінг-запиту в hot-path.
 *
 * **Кеш байтів.** Кожен запит QR-картинки інакше бив би R2 за маркою. Кешуємо
 * за R2-URL (LRU-bump, bounded): зміна бренду дає нові URL (новий uuid), тож
 * кеш само-інвалідується — старі ключі просто витісняються межею.
 *
 * **Fallback на Finly.** Будь-який збій завантаження марки (R2-транзієнт,
 * видалений файл) → `null` → контролер рендерить дефолтний Finly-бренд. Зламана
 * марка НЕ має ламати платіжний QR.
 */
@Injectable()
export class BrandMarkCacheService {
    private readonly logger = new Logger(BrandMarkCacheService.name);
    private readonly cache = new Map<string, Buffer>();
    private readonly maxEntries = 256;

    constructor(private readonly storage: StorageService) {}

    /** Байти центральної марки (тип-2) активного бренду; `null` → Finly. */
    getActiveCenterMark(business: BusinessDocument): Promise<Buffer | null> {
        return this.resolve(business.brand?.active?.centerMarkUrl);
    }

    /** Байти верхньої смуги (тип-1) активного бренду; `null` → Finly. */
    getActiveBandMark(business: BusinessDocument): Promise<Buffer | null> {
        return this.resolve(business.brand?.active?.bandMarkUrl);
    }

    private async resolve(
        url: string | null | undefined
    ): Promise<Buffer | null> {
        if (!url) return null;

        const cached = this.cache.get(url);
        if (cached) {
            // LRU-bump: пере-вставка в кінець мапи (most-recently-used).
            this.cache.delete(url);
            this.cache.set(url, cached);
            return cached;
        }

        try {
            const bytes = await this.storage.downloadByPublicUrl(url);
            this.store(url, bytes);
            return bytes;
        } catch (err) {
            this.logger.warn(
                `Failed to load brand mark "${url}": ${(err as Error).message}; falling back to Finly`
            );
            return null;
        }
    }

    private store(url: string, bytes: Buffer): void {
        if (this.cache.size >= this.maxEntries) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) {
                this.cache.delete(oldest);
            }
        }
        this.cache.set(url, bytes);
    }
}
