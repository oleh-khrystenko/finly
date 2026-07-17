import { z } from 'zod';

import {
    GuideBlockSchema,
    GuideFaqItemSchema,
    GuideSchema,
    guideDescriptionSchema,
    guideSlugSchema,
    guideTitleSchema,
} from '../entities/guide';

/**
 * Sprint 28 — write/read контракти для guides.
 *
 * Single source of truth для API DTO (`createZodDto`) і RHF-resolver-а
 * адмін-конструктора. Що навмисно відсутнє у write-схемі:
 *  - `id`, `createdAt`, `updatedAt` — генерує БД.
 *  - `status`, `datePublished`, `dateModified` — lifecycle, керується окремими
 *    діями publish/unpublish, ніколи прямим PATCH-ем.
 */
export const UpsertGuideSchema = z
    .object({
        slug: guideSlugSchema,
        title: guideTitleSchema,
        description: guideDescriptionSchema,
        authorId: z.string().min(1),
        /** `null` → стаття є pillar; інакше slug наявного pillar. */
        pillarSlug: guideSlugSchema.nullable(),
        // Контент необовʼязковий: запланована тема може бути лише назвою.
        // Наявність блоку вимагається на переході до публікації (service-layer,
        // `GUIDE_CONTENT_REQUIRED`), а не на кожному збереженні.
        blocks: z.array(GuideBlockSchema).max(100),
        faq: z.array(GuideFaqItemSchema).max(50),
    })
    .strict();

export type UpsertGuideRequest = z.infer<typeof UpsertGuideSchema>;

/**
 * Перевпорядкування статей у адмін-списку. `order` більше не редагується
 * вручну в конструкторі: він задається дією «підняти/опустити» на сторінці
 * списку. Клієнт шле повний список id у бажаному порядку, сервер присвоює
 * послідовні `order` (1..N) і перегенеровує публічні сторінки (порядок
 * впливає на дерево /guides і блок «читайте також»).
 */
export const ReorderGuidesSchema = z
    .object({
        ids: z.array(z.string().min(1)).min(1).max(500),
    })
    .strict();

export type ReorderGuidesRequest = z.infer<typeof ReorderGuidesSchema>;

/**
 * Публічний view статті. Whitelist-parse на web-boundary: строгий shape
 * захищає від дрейфу форми відповіді API.
 */
export const PublicGuideSchema = GuideSchema.pick({
    slug: true,
    title: true,
    description: true,
    authorId: true,
    pillarSlug: true,
    blocks: true,
    faq: true,
    datePublished: true,
    dateModified: true,
});

export type PublicGuide = z.infer<typeof PublicGuideSchema>;

/** Легка картка для списків, related-блоку і breadcrumb-предка. */
export const PublicGuideCardSchema = GuideSchema.pick({
    slug: true,
    title: true,
    description: true,
});

export type PublicGuideCard = z.infer<typeof PublicGuideCardSchema>;

/**
 * Відповідь публічної сторінки статті: сама стаття плюс обчислені сервером
 * звʼязки кластера (pillar для breadcrumb, related для блоку «читайте також»).
 * Обчислення на API — web не має повного списку статей.
 */
export const PublicGuideViewSchema = z.object({
    guide: PublicGuideSchema,
    pillar: PublicGuideCardSchema.nullable(),
    related: z.array(PublicGuideCardSchema),
});

export type PublicGuideView = z.infer<typeof PublicGuideViewSchema>;

/** Дерево розділу /guides: pillar-и з їх cluster-картками. */
export const PublicGuidesTreeSchema = z.array(
    z.object({
        pillar: PublicGuideCardSchema,
        clusters: z.array(PublicGuideCardSchema),
    })
);

export type PublicGuidesTree = z.infer<typeof PublicGuidesTreeSchema>;

/** Рядок адмін-списку: мета без контенту. */
export const AdminGuideListItemSchema = GuideSchema.pick({
    id: true,
    slug: true,
    title: true,
    status: true,
    pillarSlug: true,
    order: true,
    datePublished: true,
    dateModified: true,
    organicClicks: true,
    organicSyncedAt: true,
    updatedAt: true,
});

/** Підсумок ручного синку органіки (кнопка «Оновити» в адмінці). */
export const SyncOrganicResultSchema = z.object({
    updated: z.number().int().min(0),
    totalClicks: z.number().int().min(0),
});

export type SyncOrganicResult = z.infer<typeof SyncOrganicResultSchema>;

export type AdminGuideListItem = z.infer<typeof AdminGuideListItemSchema>;
