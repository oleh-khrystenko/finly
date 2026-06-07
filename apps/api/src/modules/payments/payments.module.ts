import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsCleanupService } from './payments-cleanup.service';
import { CatalogService } from './catalog.service';
import { paymentProviderProvider } from './providers/payment-provider.provider';
import { WayForPayService } from './providers/wayforpay/wayforpay.service';
import {
    ProcessedWebhookEvent,
    ProcessedWebhookEventSchema,
} from './schemas/processed-webhook-event.schema';
import {
    FailedRecurringRemoval,
    FailedRecurringRemovalSchema,
} from './schemas/failed-recurring-removal.schema';
import {
    PaymentRecord,
    PaymentRecordSchema,
} from './schemas/payment-record.schema';
import { UsersModule } from '../users/users.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            {
                name: ProcessedWebhookEvent.name,
                schema: ProcessedWebhookEventSchema,
            },
            {
                name: FailedRecurringRemoval.name,
                schema: FailedRecurringRemovalSchema,
            },
            {
                name: PaymentRecord.name,
                schema: PaymentRecordSchema,
            },
        ]),
        UsersModule,
    ],
    controllers: [PaymentsController],
    providers: [
        PaymentsService,
        PaymentsCleanupService,
        CatalogService,
        WayForPayService,
        paymentProviderProvider,
    ],
    exports: [PaymentsService, CatalogService],
})
export class PaymentsModule {}
