import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Invoice, InvoiceSchema } from '../invoices/schemas/invoice.schema';
import { InvoiceSlugGeneratorService } from '../invoices/invoice-slug-generator.service';
import { InvoicesService } from '../invoices/invoices.service';
import { QrModule } from '../qr/qr.module';
import { UsersModule } from '../users/users.module';
import { BusinessAccessGuard } from './business-access.guard';
import { BusinessesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';
import { PublicBusinessesController } from './public-businesses.controller';
import { Business, BusinessSchema } from './schemas/business.schema';
import { SlugGeneratorService } from './slug-generator.service';

/**
 * Sprint 3 §3.2 + §3.3 + Sprint 4 §4.2 — повний BusinessesModule.
 *
 * **Залежності:**
 *   - `MongooseModule.forFeature([Business, Invoice])` — Business для CRUD
 *     і slug-generator; Invoice (Sprint 4) для cascade-delete у
 *     `BusinessesService.delete` і `invoicesCount` у getBySlug response.
 *   - `QrModule` — публічний controller інжектує `QrService` для двох
 *     QR-endpoint-ів (`/qr/business.png`, `/qr/nbu.png?host=...`).
 *   - `UsersModule` — `BusinessAccessGuard` залежить від `UserDocument` типу
 *     (через `request.user`); сам user injection йде через JwtActiveGuard,
 *     але ми залишаємо UsersModule в imports на майбутнє (Sprint 3 §3.4
 *     bookkeeper toggle endpoint живе у UsersModule, не тут).
 *
 * **Чому `InvoicesService` як provider у цьому module, а не import
 * `InvoicesModule`:** уникаємо circular dependency — `InvoicesModule`
 * імпортує `BusinessesModule` (для `BusinessAccessGuard`), а
 * `BusinessesController.getBySlug` потребує `InvoicesService.countByBusinessId`.
 * `forwardRef` був би boilerplate; реєстрація `InvoicesService` як provider
 * у обох modules — clean (`@Injectable` instances ізольовані per-module-DI,
 * але service stateless, тож duplicates не мають side effects).
 *
 * **Експорт `MongooseModule`** — для зворотньої сумісності з `InvoicesModule`
 * (Sprint 1 контракт).
 */
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Business.name, schema: BusinessSchema },
            { name: Invoice.name, schema: InvoiceSchema },
        ]),
        QrModule,
        UsersModule,
    ],
    controllers: [BusinessesController, PublicBusinessesController],
    providers: [
        BusinessesService,
        SlugGeneratorService,
        BusinessAccessGuard,
        InvoiceSlugGeneratorService,
        InvoicesService,
    ],
    exports: [MongooseModule, BusinessesService],
})
export class BusinessesModule {}
