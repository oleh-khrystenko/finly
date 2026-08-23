import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { PayersModule } from '../payers/payers.module';
import {
    CreditLedgerEntry,
    CreditLedgerEntrySchema,
} from '../payments/schemas/credit-ledger-entry.schema';
import {
    PaymentRecord,
    PaymentRecordSchema,
} from '../payments/schemas/payment-record.schema';
import {
    ProcessedWebhookEvent,
    ProcessedWebhookEventSchema,
} from '../payments/schemas/processed-webhook-event.schema';
import { SlugReservationModule } from '../slug-reservation/slug-reservation.module';
import { StorageModule } from '../storage/storage.module';
import { UsersModule } from '../users/users.module';
import { AccountDeletionController } from './account-deletion.controller';
import { AccountDeletionService } from './account-deletion.service';
import { CleanupService } from './cleanup.service';

/**
 * Sprint 31 — весь життєвий цикл видалення акаунта: перелік перед підтвердженням,
 * ефекти підтвердження (гасіння публічності отримувачів + пауза списань), зняття
 * ефектів при відновленні і остаточне прибирання наприкінці вікна.
 *
 * Модуль cross-cutting і живе поза `UsersModule` рівно з тієї ж причини, що
 * `OrphanCleanupModule`: прибирання тягне і користувача, і бізнеси з їх
 * піддеревом, а зворотне ребро `Users → Businesses` зламало б one-way DAG
 * `Users ← Businesses ← Accounts ← Invoices`.
 *
 * Платіжні схеми підключені через `forFeature`, без Nest-залежності на
 * `PaymentsModule` — той сам залежить від `UsersModule`/`BusinessesModule`, і
 * пряме ребро замкнуло б цикл. `User` сюди приходить експортованим
 * `MongooseModule` з `UsersModule`, а `Business`/`Account`/`Invoice` і
 * `BillingProfile` — з `BusinessesModule` (він реєструє профіль для
 * реконсиляції).
 *
 * `EmailService` інжектиться напряму — `EmailModule` @Global, без явного імпорту.
 */
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: PaymentRecord.name, schema: PaymentRecordSchema },
            { name: CreditLedgerEntry.name, schema: CreditLedgerEntrySchema },
            {
                name: ProcessedWebhookEvent.name,
                schema: ProcessedWebhookEventSchema,
            },
        ]),
        UsersModule,
        BusinessesModule,
        AuthModule,
        PayersModule,
        SlugReservationModule,
        // Прибирання забирає і файли: логотипи отримувачів та фото профілю.
        // `StorageModule` autonomous (не імпортує ні Users, ні Businesses),
        // тож ребро безризикове — петлі немає.
        StorageModule,
    ],
    controllers: [AccountDeletionController],
    providers: [AccountDeletionService, CleanupService],
    exports: [AccountDeletionService],
})
export class AccountDeletionModule {}
