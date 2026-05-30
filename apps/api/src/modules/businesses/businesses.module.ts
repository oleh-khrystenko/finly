import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Account, AccountSchema } from '../accounts/schemas/account.schema';
import {
    InvoiceSlugCounter,
    InvoiceSlugCounterSchema,
} from '../invoices/schemas/invoice-slug-counter.schema';
import { Invoice, InvoiceSchema } from '../invoices/schemas/invoice.schema';
import { QrModule } from '../qr/qr.module';
import { UsersModule } from '../users/users.module';
import { BusinessAccessGuard } from './business-access.guard';
import { BusinessesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';
import { PublicBusinessesController } from './public-businesses.controller';
import {
    BusinessSlugHistory,
    BusinessSlugHistorySchema,
} from './schemas/business-slug-history.schema';
import { Business, BusinessSchema } from './schemas/business.schema';
import { SlugGeneratorService } from './slug-generator.service';

/**
 * Sprint 3 §3.2 + §3.3 + Sprint 4 §4.2 + Sprint 9 §9.1 — повний BusinessesModule.
 *
 * **Sprint 9 dependency-tree review fix — one-way DAG:**
 *   `Users ← Businesses ← Accounts ← Invoices`
 *
 * BusinessesModule НЕ імпортує AccountsModule / InvoicesModule (раніше було
 * `forwardRef(() => AccountsModule)` + dub-registration `InvoicesService` як
 * provider). Cabinet-cycle (BusinessesController.getBySlug потребує
 * accountsCount/invoicesCount) розв'язано через direct
 * `@InjectModel(Account.name)` + `@InjectModel(Invoice.name)` —
 * Mongoose `forFeature` тут реєструє всі 4 моделі (Business + Account +
 * Invoice + InvoiceSlugCounter), бо `BusinessesService.delete` теж робить
 * `accountModel.deleteMany({businessId})` + `invoiceModel.deleteMany` +
 * `counterModel.deleteMany` cascade у `withTransaction` (§SP-5).
 *
 * **`exports: [BusinessAccessGuard]`** — AccountsModule / InvoicesModule
 * використовують цей guard у своїх controller-ах (`@UseGuards(BusinessAccess-
 * Guard)`); export робить його resolvable у downstream-module DI.
 */
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Business.name, schema: BusinessSchema },
            {
                name: BusinessSlugHistory.name,
                schema: BusinessSlugHistorySchema,
            },
            { name: Account.name, schema: AccountSchema },
            { name: Invoice.name, schema: InvoiceSchema },
            { name: InvoiceSlugCounter.name, schema: InvoiceSlugCounterSchema },
        ]),
        UsersModule,
        QrModule,
    ],
    controllers: [BusinessesController, PublicBusinessesController],
    providers: [BusinessesService, SlugGeneratorService, BusinessAccessGuard],
    exports: [MongooseModule, BusinessesService, BusinessAccessGuard],
})
export class BusinessesModule {}
