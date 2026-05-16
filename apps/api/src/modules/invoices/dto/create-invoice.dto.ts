import { createZodDto } from 'nestjs-zod';
import { CreateInvoiceSchema } from '@finly/types';

/**
 * Sprint 4 §4.2 — DTO для `POST /businesses/me/:slug/invoices`. Контракт
 * — у `@finly/types/contracts/invoices` (Zod). `createZodDto` дає NestJS
 * runtime-валідацію через `ZodValidationPipe` (global).
 */
export class CreateInvoiceDto extends createZodDto(CreateInvoiceSchema) {}
