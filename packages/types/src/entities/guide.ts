import { z } from 'zod';

import { GUIDE_STATUSES } from '../enums/guide-status';
import { objectIdSchema } from '../validation/common';

/**
 * Sprint 28 — guide content model, DB-backed (moved out of the compile-time
 * constant of Sprint 25). An article is an ordered list of blocks (heading,
 * markdown text, optional image) plus a FAQ list — the exact shape the admin
 * constructor produces. No stored HTML by design: layout, themes and SEO
 * markup are guaranteed by the site components, the author owns content only.
 *
 * Authors intentionally stay compile-time (`HELP_AUTHORS`): one author, rare
 * changes, shared with help so the E-E-A-T identity is consistent site-wide.
 */

/** Admin-authored slug: lowercase kebab, stable once published (locked). */
export const guideSlugSchema = z
    .string()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'INVALID_GUIDE_SLUG' });

export const guideTitleSchema = z.string().trim().min(3).max(120);

export const guideDescriptionSchema = z.string().trim().min(10).max(300);

/**
 * Real pixel dimensions are required: without them the public page cannot
 * reserve space for the image and the layout jumps while it loads. The admin
 * uploader reads them from the decoded image before submit.
 */
/** Абсолютний URL (R2) або site-відносний шлях (`/landing/...` demo-ассети). */
const guideImageSrcSchema = z
    .string()
    .min(1)
    .max(500)
    .refine((src) => src.startsWith('/') || /^https?:\/\//.test(src), {
        message: 'INVALID_GUIDE_IMAGE_SRC',
    });

export const GuideBlockImageSchema = z.object({
    src: guideImageSrcSchema,
    alt: z.string().trim().min(3).max(200),
    width: z.number().int().positive().max(8000),
    height: z.number().int().positive().max(8000),
    caption: z.string().trim().min(3).max(300).optional(),
});

export const GuideBlockSchema = z.object({
    heading: z.string().trim().min(3).max(120).optional(),
    /** Markdown. A block renders only when it has text, so text is required. */
    text: z.string().trim().min(1).max(20000),
    image: GuideBlockImageSchema.optional(),
});

/**
 * FAQ entry. Answer is flat text — the single source for both the visible
 * block and the FAQPage structured data, so they cannot drift. The markup
 * stays for AI search / entity parsers (AEO), not for stars in the SERP.
 */
export const GuideFaqItemSchema = z.object({
    question: z.string().trim().min(3).max(300),
    answer: z.string().trim().min(3).max(2000),
});

/** Date-only ISO (YYYY-MM-DD), Kyiv-local — same freshness convention as help. */
export const guideDateSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'INVALID_GUIDE_DATE' });

export const GuideSchema = z.object({
    id: objectIdSchema,
    slug: guideSlugSchema,
    title: guideTitleSchema,
    description: guideDescriptionSchema,
    /** References a compile-time HelpAuthor.id (byline + Person schema). */
    authorId: z.string().min(1),
    status: z.enum(GUIDE_STATUSES),
    /**
     * Topical-authority role. `null` → pillar (broad topic that spreads link
     * equity to its cluster). Otherwise the slug of the pillar this cluster
     * belongs to (breadcrumb + pillar↔cluster links).
     */
    pillarSlug: guideSlugSchema.nullable(),
    /** Display order within a pillar's cluster list (and pillar order on /guides). */
    order: z.number().int().min(1).max(999),
    blocks: z.array(GuideBlockSchema).min(1),
    faq: z.array(GuideFaqItemSchema),
    /** Set automatically on first publish; null while the guide is a draft. */
    datePublished: guideDateSchema.nullable(),
    /** Bumped on publish of changes — an honest freshness signal, never faked. */
    dateModified: guideDateSchema.nullable(),
    /** Органічні кліки з Google-пошуку за останні 28 днів (синк із Search Console). */
    organicClicks: z.number().int().min(0),
    /** Коли останній раз тягли organicClicks; null — ще не синкали. */
    organicSyncedAt: z.coerce.date().nullable(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
});

export type GuideBlockImage = z.infer<typeof GuideBlockImageSchema>;
export type GuideBlock = z.infer<typeof GuideBlockSchema>;
export type GuideFaqItem = z.infer<typeof GuideFaqItemSchema>;
export type Guide = z.infer<typeof GuideSchema>;
