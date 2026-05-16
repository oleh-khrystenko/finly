import { z } from 'zod';

import {
    businessNameSchema,
    businessPaymentPurposeTemplateSchema,
} from '../entities/business';
import { ibanZod } from '../validation/iban';
import { individualTaxIdZod } from '../validation/tax-id';

/**
 * Sprint 8 §8.0 — input для публічного QR-preview-ендпоінту
 * (`POST /api/qr/preview`, без auth, без cookie, без БД).
 *
 * **Жорстко прибито до `'individual'` (Фіз особа).** Немає поля `type`, taxId
 * валідується саме як 10-цифровий РНОКПП з ДПС-checksum
 * (`individualTaxIdZod`), а не union RNOKPP+ЄДРПОУ. Якщо колись захочемо
 * anon-демо для ТОВ — це нова Zod-схема, не розширення цієї: розгалуження за
 * `type` тягне taxation-fields, ПДВ-payer, per-variant taxId-валідатор —
 * усе, що Sprint 7 §SP-3 розклав на `discriminatedUnion` у
 * `CreateBusinessSchema`. Anon-форма свідомо одно-варіантна
 * (sprint-plan §НЕ-скоуп).
 *
 * **Reuse field-рівневих схем з cabinet-write-path** (`businessNameSchema`,
 * `businessPaymentPurposeTemplateSchema`, `ibanZod`, `individualTaxIdZod`)
 * тримає landing input під тими самими NBU charset + byte-limits, що
 * cabinet-wizard. Single source of truth для "що валідне у нашому
 * QR-payload-і": якщо field-limit зміниться у Sprint 9+, landing і wizard
 * рухаються синхронно без drift-у.
 *
 * **`.strict()`** — невідомі ключі payload-у (наприклад, спроба передати
 * `amount`/`validUntil` зі скоупу Sprint 9+ або `type='fop'`) reject-аться
 * ZodValidationPipe-ом як 400 `VALIDATION_ERROR`, а не silent-ignore. Anon
 * surface — підвищена attack surface, тому контракт максимально вузький.
 */
export const QrPreviewInputSchema = z
    .object({
        receiverName: businessNameSchema,
        iban: ibanZod,
        taxId: individualTaxIdZod,
        purpose: businessPaymentPurposeTemplateSchema,
    })
    .strict();

export type QrPreviewInput = z.infer<typeof QrPreviewInputSchema>;

/**
 * Response-схема для `POST /api/qr/preview`. Symmetric з backend-format-ом
 * `{ data: QrPreviewResponse }` (RESPONSE-envelope конвенція з решти
 * controller-ів). Frontend `fetchQrPreview` reuse цю саму схему для
 * runtime-валідації response-у — захист від silent-shape-drift backend-у.
 *
 * **`qrPngBase64` без префіксу `data:image/png;base64,`** — чистий base64,
 * щоб клієнт сам обрав spelling префіксу для `<img src=...>` чи
 * `Buffer.from(base64, 'base64')`. Sprint 8 frontend (`UiQrImage`) приймає
 * `data:`-URL і додає префікс на місці.
 */
export const QrPreviewResponseSchema = z.object({
    /** Universal NBU payload-link, формат 003, host = `qr.bank.gov.ua`. */
    link: z.string().url(),
    /** PNG QR-код, base64-encoded (без префіксу `data:image/png;base64,`). */
    qrPngBase64: z.string().min(1),
});

export type QrPreviewResponse = z.infer<typeof QrPreviewResponseSchema>;
