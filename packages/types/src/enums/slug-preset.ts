import { z } from 'zod';

export const SLUG_PRESETS = [
    'simple',
    'with-month',
    'with-year',
    'with-purpose',
] as const;

export type SlugPreset = (typeof SLUG_PRESETS)[number];

/**
 * Zod-схема для `SlugPreset`. Живе у enum-модулі (а не у `entities/invoice.ts`,
 * де була до Sprint 8 fix), щоб уникнути циркулярного імпорту
 * `entities/business.ts ↔ entities/invoice.ts`. Без цього `invoice.ts` не міг
 * би імпортувати `businessNameSchema` з `business.ts` для reuse у
 * `InvoicePayeeSnapshotSchema.recipientName` — inline-`payeeNameSchema` drift-
 * нув від `businessNameSchema` після додавання NBU-charset refine, і
 * snapshot-shape пропускав emoji у NBU payload через invoice flow.
 */
export const slugPresetSchema = z.enum(SLUG_PRESETS);
