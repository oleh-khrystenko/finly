import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
    GUIDE_STATUSES,
    type GuideBlock,
    type GuideFaqItem,
    type GuideStatus,
} from '@finly/types';

import { applyJsonTransform } from '../../../common/mongoose/json-transform';

export type GuideDocument = HydratedDocument<Guide>;

/**
 * Sprint 28 — SEO-гайд, DB-backed (переїзд з compile-time константи Sprint 25).
 *
 * **Інваріанти, що Mongoose НЕ перевіряє** (живуть у Zod DTO / service-layer):
 *  - Формат блоків/FAQ (min/max довжини, розміри картинок) — `UpsertGuideSchema`.
 *  - `slug` незмінний після першої публікації (`datePublished !== null`) —
 *    service-layer, `GUIDE_SLUG_LOCKED`.
 *  - `pillarSlug` вказує на наявний pillar (не cluster, не сам на себе) —
 *    service-layer, `GUIDE_PILLAR_INVALID`.
 *  - Delete лише для чернеток — service-layer, `GUIDE_PUBLISHED_DELETE_FORBIDDEN`.
 */
@Schema({ timestamps: true })
export class Guide {
    /**
     * Admin-authored kebab-slug, глобально unique. Без slugLower-пари
     * (на відміну від business/account): значення нормалізується lowercase
     * ще у Zod-валідації форми, кейс-варіацій не існує.
     */
    @Prop({ required: true, trim: true, unique: true })
    slug!: string;

    @Prop({ required: true, trim: true })
    title!: string;

    @Prop({ required: true, trim: true })
    description!: string;

    /** Compile-time HelpAuthor.id — автори лишаються в коді (Sprint 28 Q&A). */
    @Prop({ required: true, trim: true })
    authorId!: string;

    @Prop({ type: String, enum: GUIDE_STATUSES, default: 'draft' })
    status!: GuideStatus;

    /** `null` → pillar; інакше slug pillar-а, до якого належить cluster. */
    @Prop({ type: String, default: null })
    pillarSlug!: string | null;

    @Prop({ required: true, type: Number })
    order!: number;

    /**
     * Впорядковані блоки контенту (heading?, markdown text, image?). Структурна
     * валідація — на Zod DTO boundary; Mongo зберігає як вкладені обʼєкти.
     */
    @Prop({ type: Array, required: true })
    blocks!: GuideBlock[];

    @Prop({ type: Array, default: [] })
    faq!: GuideFaqItem[];

    /** Date-only ISO (Kyiv). Ставиться першою публікацією, далі незмінна. */
    @Prop({ type: String, default: null })
    datePublished!: string | null;

    /** Date-only ISO (Kyiv). Бампається кожною публікацією змін. */
    @Prop({ type: String, default: null })
    dateModified!: string | null;

    /** Органічні кліки з Google-пошуку за 28 днів (синк із Search Console). */
    @Prop({ type: Number, default: 0 })
    organicClicks!: number;

    /** Коли останній раз синкали organicClicks; null — ще ні. */
    @Prop({ type: Date, default: null })
    organicSyncedAt!: Date | null;

    createdAt!: Date;
    updatedAt!: Date;
}

export const GuideSchema = SchemaFactory.createForClass(Guide);

applyJsonTransform(GuideSchema);

/** Публічний список і lookup: тільки опубліковане, стабільний порядок. */
GuideSchema.index({ status: 1, pillarSlug: 1, order: 1 });
