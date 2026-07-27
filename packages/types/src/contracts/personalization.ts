import { z } from 'zod';

import { isWithinNbuCharset } from '../qr/charset';
import { individualTaxIdZod } from '../validation/tax-id';

/**
 * Sprint 29 — параметри персоналізації призначення платежу на публічній сторінці
 * системного отримувача (податкова). Значення підставляються у шаблон з маркерами
 * (`{taxId}`, `{fullName}`, `{period}`) перед генерацією QR. Усі опційні на рівні
 * схеми; сервіс вимагає саме ті, що є маркерами у шаблоні.
 *
 * Приходять як query-параметри (щоб персональне посилання можна було переслати),
 * тому схема не `.strict()` — сторонні query-ключі (`host`, `size`, `v`)
 * відкидаються, не валяться.
 */
const personalizationTextValue = (max: number) =>
    z
        .string()
        .trim()
        .min(1, { message: 'INVALID_PERSONALIZATION_REQUIRED' })
        .max(max, { message: 'INVALID_PERSONALIZATION_TOO_LONG' })
        .refine(isWithinNbuCharset, {
            message: 'INVALID_PERSONALIZATION_CHARSET',
        });

/**
 * Ліміти довжини значень персоналізації. Іменовані експорти, бо ті самі числа
 * потрібні UI (maxLength інпута, текст помилки): голий літерал у формі мовчки
 * розійшовся б зі схемою при зміні ліміту.
 */
export const PERSONALIZATION_FULL_NAME_MAX = 80;
export const PERSONALIZATION_PERIOD_MAX = 64;

/**
 * Поле-схеми окремо, щоб публічна сторінка (клієнт) валідувала кожне поле тими
 * самими правилами, що й сервер (NBU-charset + ліміт довжини), а не лише на
 * непорожність. Інакше невалідний ПІБ проходив би клієнтський гейт і давав биту
 * QR-картинку без зрозумілої причини.
 */
export const personalizationFullNameZod = personalizationTextValue(
    PERSONALIZATION_FULL_NAME_MAX
);
export const personalizationPeriodZod = personalizationTextValue(
    PERSONALIZATION_PERIOD_MAX
);

export const PersonalizationParamsSchema = z.object({
    taxId: individualTaxIdZod.optional(),
    fullName: personalizationFullNameZod.optional(),
    period: personalizationPeriodZod.optional(),
});

export type PersonalizationParams = z.infer<typeof PersonalizationParamsSchema>;

/** Персоналізовані NBU-посилання (universal-links) для «тапни свій банк». */
export const PersonalizedNbuLinksSchema = z.object({
    nbuLinks: z.object({
        primary: z.string().url(),
        legacy: z.string().url(),
    }),
});

export type PersonalizedNbuLinks = z.infer<typeof PersonalizedNbuLinksSchema>;
