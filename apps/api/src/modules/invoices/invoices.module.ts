import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BusinessesModule } from '../businesses/businesses.module';
import { QrModule } from '../qr/qr.module';
import { InvoiceAccessGuard } from './invoice-access.guard';
import { InvoiceSlugGeneratorService } from './invoice-slug-generator.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PublicInvoicesController } from './public-invoices.controller';
import { Invoice, InvoiceSchema } from './schemas/invoice.schema';

/**
 * Sprint 4 §4.2 + §4.3 — повний InvoicesModule: schema + slug-generator +
 * service + controllers (cabinet + public) + access-guard + payload-mapper.
 *
 * **Циклічна залежність з `BusinessesModule`** (через `forwardRef`):
 *  - `InvoicesModule` потребує `BusinessAccessGuard` (з `BusinessesModule`)
 *    у chain `InvoicesController`, і `BusinessesService.getBySlug` для
 *    `PublicInvoicesController` lookup-у.
 *  - `BusinessesModule` повторно реєструє `InvoicesService` як provider для
 *    `BusinessesController.getBySlug` (`invoicesCount`). Це не обов'язково
 *    import з `InvoicesModule` — тримати окрему DI-instance per-module
 *    прийнятно (service stateless).
 *
 * **`QrModule` — для `PublicInvoicesController.qrService`** (§4.3): QR-image
 * render + NBU-payload-link build. Той самий QR-service-instance, що
 * Sprint 3 `PublicBusinessesController` використовує для business-flow.
 *
 * `forwardRef(() => BusinessesModule)` — захист від import-time-undefined,
 * якщо обидва modules імпортують один одного на module-level.
 */
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Invoice.name, schema: InvoiceSchema },
        ]),
        forwardRef(() => BusinessesModule),
        QrModule,
    ],
    controllers: [InvoicesController, PublicInvoicesController],
    providers: [
        InvoiceSlugGeneratorService,
        InvoicesService,
        InvoiceAccessGuard,
    ],
    exports: [MongooseModule, InvoiceSlugGeneratorService, InvoicesService],
})
export class InvoicesModule {}
