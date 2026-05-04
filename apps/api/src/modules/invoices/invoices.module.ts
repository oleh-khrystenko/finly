import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BusinessesModule } from '../businesses/businesses.module';
import { InvoiceAccessGuard } from './invoice-access.guard';
import { InvoiceSlugGeneratorService } from './invoice-slug-generator.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { Invoice, InvoiceSchema } from './schemas/invoice.schema';

/**
 * Sprint 4 §4.2 — повний InvoicesModule: schema + slug-generator + service +
 * controller + access-guard.
 *
 * **Циклічна залежність з `BusinessesModule`** (через `forwardRef`):
 *  - `InvoicesModule` потребує `BusinessAccessGuard` (з `BusinessesModule`)
 *    у chain `InvoicesController` — щоб `:slug` route-param був resolved
 *    і attached як `request.business` до `InvoiceAccessGuard`.
 *  - `BusinessesModule` повторно реєструє `InvoicesService` як provider для
 *    `BusinessesController.getBySlug` (`invoicesCount` у response). Це не
 *    обов'язково import з `InvoicesModule` — тримати окрему DI-instance
 *    per-module прийнятно (service stateless).
 *
 * `forwardRef(() => BusinessesModule)` — захист від import-time-undefined,
 * якщо обидва modules імпортують один одного на module-level (рідкісно,
 * але safer-pattern для Nest cycle resolution).
 */
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Invoice.name, schema: InvoiceSchema },
        ]),
        forwardRef(() => BusinessesModule),
    ],
    controllers: [InvoicesController],
    providers: [
        InvoiceSlugGeneratorService,
        InvoicesService,
        InvoiceAccessGuard,
    ],
    exports: [MongooseModule, InvoiceSlugGeneratorService, InvoicesService],
})
export class InvoicesModule {}
