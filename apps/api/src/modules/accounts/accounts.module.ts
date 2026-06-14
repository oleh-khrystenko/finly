import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BusinessesModule } from '../businesses/businesses.module';
import {
    Business,
    BusinessSchema,
} from '../businesses/schemas/business.schema';
import {
    InvoiceSlugCounter,
    InvoiceSlugCounterSchema,
} from '../invoices/schemas/invoice-slug-counter.schema';
import {
    InvoiceSlugHistory,
    InvoiceSlugHistorySchema,
} from '../invoices/schemas/invoice-slug-history.schema';
import { Invoice, InvoiceSchema } from '../invoices/schemas/invoice.schema';
import { QrModule } from '../qr/qr.module';
import { SlugReservationModule } from '../slug-reservation/slug-reservation.module';
import { AccountAccessGuard } from './account-access.guard';
import { AccountSlugGeneratorService } from './account-slug-generator.service';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { PublicAccountsController } from './public-accounts.controller';
import {
    AccountSlugHistory,
    AccountSlugHistorySchema,
} from './schemas/account-slug-history.schema';
import { Account, AccountSchema } from './schemas/account.schema';

/**
 * Sprint 9 §9.1 — Account-домен.
 *
 * **Dependency direction (Sprint 9 review fix):** AccountsModule плоско
 * імпортує `BusinessesModule` (one-way), без `forwardRef`. Cycle
 * `Businesses ↔ Accounts` усунено: BusinessesModule більше НЕ імпортує
 * AccountsModule (cabinet-counter-aggregation працює через direct
 * `@InjectModel`-у businesses-controller-і).
 *
 * **MongooseModule.forFeature** — моделі, потрібні для own-CRUD і cascade-delete:
 *  - `Account` — own CRUD.
 *  - `Business` — `AccountsService.create` робить touch-business у власній tx
 *    (orphan-prevention vs cascade-delete-business, §SP-1).
 *  - `Invoice` + `InvoiceSlugCounter` + `InvoiceSlugHistory` —
 *    `AccountsService.delete` cascade-видаляє увесь invoice-піддерев'я рахунку
 *    (`deleteMany({accountId})`) разом з власною `AccountSlugHistory` у одній tx.
 *
 * `BusinessesService` доступний через `imports: [BusinessesModule]` —
 * `PublicAccountsController` використовує `BusinessesService.getBySlug` для
 * lookup-chain (business → account).
 *
 * `BusinessAccessGuard` теж доступний через BusinessesModule's exports —
 * `AccountsController` використовує його у guard-chain.
 *
 * **`exports: [AccountAccessGuard]`** — InvoicesModule використовує цей guard
 * у `InvoicesController` chain.
 */
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Account.name, schema: AccountSchema },
            {
                name: AccountSlugHistory.name,
                schema: AccountSlugHistorySchema,
            },
            { name: Business.name, schema: BusinessSchema },
            { name: Invoice.name, schema: InvoiceSchema },
            { name: InvoiceSlugCounter.name, schema: InvoiceSlugCounterSchema },
            {
                name: InvoiceSlugHistory.name,
                schema: InvoiceSlugHistorySchema,
            },
        ]),
        BusinessesModule,
        QrModule,
        SlugReservationModule,
    ],
    controllers: [AccountsController, PublicAccountsController],
    providers: [
        AccountsService,
        AccountSlugGeneratorService,
        AccountAccessGuard,
    ],
    exports: [MongooseModule, AccountsService, AccountAccessGuard],
})
export class AccountsModule {}
