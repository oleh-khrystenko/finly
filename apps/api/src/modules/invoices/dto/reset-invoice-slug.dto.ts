import { createZodDto } from 'nestjs-zod';
import { ResetInvoiceSlugSchema } from '@finly/types';

/**
 * Sprint 17 §billing-design — DTO для `POST .../reset-slug`. `mode` — one-time
 * формат перевипуску (5 авто-режимів); відсутність → fallback на
 * `account.invoiceSlugPresetDefault`. Перевипуск дефолт рахунку не змінює.
 */
export class ResetInvoiceSlugDto extends createZodDto(ResetInvoiceSlugSchema) {}
