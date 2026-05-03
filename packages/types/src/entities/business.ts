import { z } from 'zod';

import { MVP_BANKS } from '../constants/banks';
import { BUSINESS_TYPES } from '../enums/business-type';
import { effectiveLimit, isWithinByteLimit } from '../qr/limits';
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
 * - Free-tier обмеження на `acceptedBanks` — app-layer у Sprint 6.
 *
 * **Length-обмеження `name` і `paymentPurposeTemplate` derived-from-spec**
 * через `effectiveLimit(...)` = MIN по `PAYLOAD_VERSIONS` (Sprint 2 §2.2).
 * Інваріант: будь-який валідно збережений Business може згенерувати валідний
 * QR для будь-якої з підтримуваних версій. Інакше отримуємо антипатерн
 * "save succeeds, render later fails" — клієнт не може заплатити, ФОП не
 * розуміє чому, помилка вилазить далеко від місця її введення.
 *
 * **Інваріант `ownerId === null ⇒ managers.length ≥ 1`** перевіряється у самій
 * entity-схемі: ownerless-бізнес без керівників — невалідний стан БД (нема як
 * до нього достукатись), Mongoose такого комбінаторного правила не виразить.
 */

const NAME_LIMIT = effectiveLimit('receiverName');
const PURPOSE_LIMIT = effectiveLimit('purpose');

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

export const businessNameSchema = z
    .string()
    .trim()
    .min(1)
    .max(NAME_LIMIT.chars, { message: 'INVALID_NAME_CHAR_LENGTH' })
    .refine((v) => isWithinByteLimit(v, NAME_LIMIT.bytes), {
        message: 'INVALID_NAME_BYTE_LENGTH',
    });

export const businessPaymentPurposeTemplateSchema = z
    .string()
    .trim()
    .min(1)
    .max(PURPOSE_LIMIT.chars, { message: 'INVALID_PURPOSE_CHAR_LENGTH' })
    .refine((v) => isWithinByteLimit(v, PURPOSE_LIMIT.bytes), {
        message: 'INVALID_PURPOSE_BYTE_LENGTH',
    });

export const BusinessSchema = z
    .object({
        id: objectIdSchema,
        type: businessTypeSchema,
        ownerId: objectIdSchema.nullable(),
        managers: z.array(objectIdSchema),
        slug: businessSlugSchema,
        name: businessNameSchema,
        requisites: BusinessRequisitesSchema,
        paymentPurposeTemplate: businessPaymentPurposeTemplateSchema,
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
