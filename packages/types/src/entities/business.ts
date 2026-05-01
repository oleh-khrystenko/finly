import { z } from 'zod';

import { MVP_BANKS } from '../constants/banks';
import { BUSINESS_TYPES } from '../enums/business-type';
import { objectIdSchema } from '../validation/common';
import { ibanZod } from '../validation/iban';
import { individualTaxIdZod } from '../validation/tax-id';

/**
 * Бізнес — постійна сутність з унікальною публічною сторінкою
 * (`pay.finly.com.ua/{slug}`). Успадковується інвойсами.
 *
 * **Що Zod-схема НЕ перевіряє** (свідомо, бо це write-side / runtime-time):
 * - Унікальність `slug` глобально — Mongoose unique index у Block 3.
 * - Резервовані slug-и (`qr`, `api`, …) — slug-генератор у Sprint 3.
 * - Per-version (002/003) обмеження довжини `name` / `paymentPurposeTemplate` —
 *   payload-builder у Sprint 2 поверх існуючих `min/max`.
 * - Free-tier обмеження на `acceptedBanks` — app-layer у Sprint 6.
 *
 * **Інваріант `ownerId === null ⇒ managers.length ≥ 1`** перевіряється у самій
 * entity-схемі: ownerless-бізнес без керівників — невалідний стан БД (нема як
 * до нього достукатись), Mongoose такого комбінаторного правила не виразить.
 */

export const businessTypeSchema = z.enum(BUSINESS_TYPES);
export const bankCodeSchema = z.enum(MVP_BANKS);

/**
 * Slug формату DNS-style: lowercase, kebab-case, без дефіса на краях, без
 * послідовних дефісів. Reserved-список і unique-перевірка — поза цією схемою.
 */
export const businessSlugSchema = z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'INVALID_SLUG_FORMAT' });

export const BusinessRequisitesSchema = z.object({
    iban: ibanZod,
    taxId: individualTaxIdZod,
});

export const BusinessSchema = z
    .object({
        id: objectIdSchema,
        type: businessTypeSchema,
        ownerId: objectIdSchema.nullable(),
        managers: z.array(objectIdSchema),
        slug: businessSlugSchema,
        name: z.string().trim().min(1).max(140),
        requisites: BusinessRequisitesSchema,
        paymentPurposeTemplate: z.string().trim().min(1).max(420),
        acceptedBanks: z.array(bankCodeSchema),
        deletedAt: z.coerce.date().nullable(),
        createdAt: z.coerce.date(),
        updatedAt: z.coerce.date(),
    })
    .refine((b) => b.ownerId !== null || b.managers.length >= 1, {
        message: 'OWNERLESS_BUSINESS_REQUIRES_MANAGER',
        path: ['managers'],
    });

export type Business = z.infer<typeof BusinessSchema>;
export type BusinessRequisites = z.infer<typeof BusinessRequisitesSchema>;
