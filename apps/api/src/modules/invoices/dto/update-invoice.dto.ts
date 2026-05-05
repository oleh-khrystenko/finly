import { createZodDto } from 'nestjs-zod';
import { UpdateInvoiceSchema } from '@finly/types';

/**
 * Sprint 4 §4.2 — DTO для `PATCH /businesses/me/:slug/invoices/:invoiceSlug`.
 * `.strict()` modifier на схемі блокує спробу змінити `slug`/`slugPreset`/
 * `businessId` (slug immutable у Sprint 4 §"НЕ-скоуп").
 */
export class UpdateInvoiceDto extends createZodDto(UpdateInvoiceSchema) {}
