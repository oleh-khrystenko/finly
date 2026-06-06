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
    OrphanedProviderCustomer,
    OrphanedProviderCustomerSchema,
} from './schemas/orphaned-provider-customer.schema';
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
                name: OrphanedProviderCustomer.name,
                schema: OrphanedProviderCustomerSchema,
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
