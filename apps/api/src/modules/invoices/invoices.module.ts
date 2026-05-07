import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BusinessesModule } from '../businesses/businesses.module';
import {
    Business,
    BusinessSchema,
} from '../businesses/schemas/business.schema';
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
        // Sprint 4 review fix — реєструємо `Business` теж, щоб
        // `InvoicesService.create` міг touch-нути business document у тій
        // самій транзакції (orphan-prevention guard, див. service-doc).
        // Mongoose `forFeature` з тим самим schema-ім'ям повертає той самий
        // singleton model під одним connection-ом — реєстрація в обох
        // модулях не дублює state.
        MongooseModule.forFeature([
            { name: Invoice.name, schema: InvoiceSchema },
            { name: Business.name, schema: BusinessSchema },
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
