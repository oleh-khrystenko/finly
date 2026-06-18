import { z } from 'zod';

/**
 * Sprint 21 — кастомний брендинг отримувача. Бренд живе на рівні Business
 * (успадковують усі рахунки/інвойси й обидва типи QR), має два окремі слоти:
 *
 *  - `active` — те, що рендериться публічно. Промотується з `pending` успішною
 *    оплатою; демоутиться назад у `pending` реконсиляцією при падінні рівня
 *    доступу нижче `brand` (файл лишається, публічно повертається Finly).
 *  - `pending` — завантажене, але ще не активне (free до оплати, або
 *    демоутований active). Несе `uploadedAt` для cron-чистки orphan-файлів
 *    неоплачених.
 *
 * Кожен слот зберігає три R2-asset-и: оригінальний логотип (показ на публічних
 * pay-сторінках + публічна whitelist-схема) і дві пре-композовані «бренд-марки»
 * (bake-on-commit) під дві позиції рендеру — центр сторінкового QR (тип-2) і
 * верхня смуга НБУ-QR (тип-1). Опційна `displayName` — косметичний підпис нашим
 * шрифтом; НЕ дорівнює юридичній `Business.name` і НІКОЛИ не потрапляє у
 * QR-payload (тип-2 кодує лише URL, у тип-1 receiverName лишається юр-назва).
 */

/**
 * Косметична текстова назва бренду. Жорсткий ліміт довжини (запікається нашим
 * шрифтом у бренд-марку й рендериться у вузькій смузі НБУ-QR — довший рядок
 * не вмістився б). Контрол-символи й переноси рядків блокуються: бренд-марка
 * однорядкова, а LF/CR зламали б її layout. NBU-charset тут НЕ застосовується —
 * це не платіжні дані, у QR-payload назва не йде.
 */
export const BRAND_DISPLAY_NAME_MAX_LENGTH = 40;

const CONTROL_CHAR_DEL = 0x7f;
const CONTROL_CHAR_MAX = 0x1f;

export const brandDisplayNameSchema = z
    .string()
    .trim()
    .min(1, { message: 'INVALID_BRAND_NAME_REQUIRED' })
    .max(BRAND_DISPLAY_NAME_MAX_LENGTH, {
        message: 'INVALID_BRAND_NAME_TOO_LONG',
    })
    .refine(
        (v) =>
            ![...v].some((ch) => {
                const code = ch.charCodeAt(0);
                return code <= CONTROL_CHAR_MAX || code === CONTROL_CHAR_DEL;
            }),
        { message: 'INVALID_BRAND_NAME_CHARSET' }
    );

export const brandSlotSchema = z.object({
    /** Оригінальний завантажений логотип (R2). Показ на pay-сторінках + публічна whitelist-схема. */
    logoUrl: z.string().url(),
    /** Пре-композована бренд-марка під центр сторінкового QR (тип-2). */
    centerMarkUrl: z.string().url(),
    /** Пре-композована бренд-марка під верхню смугу НБУ-QR (тип-1). */
    bandMarkUrl: z.string().url(),
    displayName: brandDisplayNameSchema.nullable(),
});

export type BrandSlot = z.infer<typeof brandSlotSchema>;

export const pendingBrandSlotSchema = brandSlotSchema.extend({
    /** Мітка часу завантаження — cron-чистка orphan pending-логотипів неоплачених. */
    uploadedAt: z.coerce.date(),
});

export type PendingBrandSlot = z.infer<typeof pendingBrandSlotSchema>;

export const businessBrandSchema = z.object({
    active: brandSlotSchema.nullable(),
    pending: pendingBrandSlotSchema.nullable(),
});

export type BusinessBrand = z.infer<typeof businessBrandSchema>;
