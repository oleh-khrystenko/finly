import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccountsModule } from '../accounts/accounts.module';
import { Account, AccountSchema } from '../accounts/schemas/account.schema';
import { BusinessesModule } from '../businesses/businesses.module';
import { QrModule } from '../qr/qr.module';
import { InvoiceAccessGuard } from './invoice-access.guard';
import { InvoiceSlugGeneratorService } from './invoice-slug-generator.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PublicInvoicesController } from './public-invoices.controller';
import {
    InvoiceSlugCounter,
    InvoiceSlugCounterSchema,
} from './schemas/invoice-slug-counter.schema';
import {
    InvoiceSlugHistory,
    InvoiceSlugHistorySchema,
} from './schemas/invoice-slug-history.schema';
import { Invoice, InvoiceSchema } from './schemas/invoice.schema';

/**
 * Sprint 4 §4.2 + §4.3 + Sprint 9 §9.1 — повний InvoicesModule.
 *
 * **One-way dependency tree (Sprint 9 review fix):**
 *   `Users ← Businesses ← Accounts ← Invoices`
 *
 * InvoicesModule плоско імпортує `BusinessesModule` + `AccountsModule` —
 * без `forwardRef`. Cycle усунено через перенесення cabinet-counter-flow з
 * BusinessesController на direct `@InjectModel` (раніше BusinessesModule
 * робило dub-registration `InvoicesService` як provider — Sprint 4 patern,
 * Sprint 9 видалив через duplicate-DI-instance ризик).
 *
 * **Mongoose `forFeature([Invoice, Account, InvoiceSlugCounter])`:**
 *  - `Invoice` — own CRUD.
 *  - `Account` — `InvoicesService.create` робить touch-account у власній tx
 *    (orphan-prevention vs cascade-delete-account, §SP-3).
 *  - `InvoiceSlugCounter` — counter-doc-allocation у `InvoiceSlugGeneratorService`.
 *
 * `BusinessAccessGuard` + `AccountAccessGuard` доступні через
 * BusinessesModule + AccountsModule exports — InvoicesController chain
 * `@UseGuards(JwtActive, BusinessAccess, AccountAccess)`.
 */
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Invoice.name, schema: InvoiceSchema },
            {
                name: InvoiceSlugHistory.name,
                schema: InvoiceSlugHistorySchema,
            },
            { name: Account.name, schema: AccountSchema },
            { name: InvoiceSlugCounter.name, schema: InvoiceSlugCounterSchema },
        ]),
        BusinessesModule,
        AccountsModule,
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
