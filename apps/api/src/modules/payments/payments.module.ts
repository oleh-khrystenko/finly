import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsController } from './payments.controller';
import { BillingProfileService } from './billing-profile.service';
import { PaymentsCleanupService } from './payments-cleanup.service';
import { BillingClockService } from './billing-clock.service';
import { CatalogService } from './catalog.service';
import { paymentProviderProvider } from './providers/payment-provider.provider';
import { MonobankService } from './providers/monobank/monobank.service';
import {
    ProcessedWebhookEvent,
    ProcessedWebhookEventSchema,
} from './schemas/processed-webhook-event.schema';
import {
    PaymentRecord,
    PaymentRecordSchema,
} from './schemas/payment-record.schema';
import {
    BillingProfile,
    BillingProfileSchema,
} from './schemas/billing-profile.schema';
import {
    CreditLedgerEntry,
    CreditLedgerEntrySchema,
} from './schemas/credit-ledger-entry.schema';
import { UsersModule } from '../users/users.module';
import { BusinessesModule } from '../businesses/businesses.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            {
                name: ProcessedWebhookEvent.name,
                schema: ProcessedWebhookEventSchema,
            },
            {
                name: PaymentRecord.name,
                schema: PaymentRecordSchema,
            },
            {
                name: BillingProfile.name,
                schema: BillingProfileSchema,
            },
            {
                name: CreditLedgerEntry.name,
                schema: CreditLedgerEntrySchema,
            },
        ]),
        UsersModule,
        // Sprint 27 — реконсиляція бізнесів per-business при зміні прикріплень.
        BusinessesModule,
    ],
    controllers: [PaymentsController],
    providers: [
        BillingProfileService,
        PaymentsCleanupService,
        BillingClockService,
        CatalogService,
        MonobankService,
        paymentProviderProvider,
    ],
    exports: [BillingProfileService, CatalogService],
})
export class PaymentsModule {}
