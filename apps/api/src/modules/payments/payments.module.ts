import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
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
        ]),
        UsersModule,
        // Sprint 19 — реконсиляція бізнесів при зміні білінг-стану.
        BusinessesModule,
    ],
    controllers: [PaymentsController],
    providers: [
        PaymentsService,
        PaymentsCleanupService,
        BillingClockService,
        CatalogService,
        MonobankService,
        paymentProviderProvider,
    ],
    exports: [PaymentsService, CatalogService],
})
export class PaymentsModule {}
