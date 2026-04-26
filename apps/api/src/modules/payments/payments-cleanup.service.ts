import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';

import {
    PAYMENT_PROVIDER,
    IPaymentProvider,
} from './interfaces/payment-provider.interface';
import {
    OrphanedProviderCustomer,
    OrphanedProviderCustomerDocument,
} from './schemas/orphaned-provider-customer.schema';

/** Stop retrying after this many failed attempts. */
const MAX_ATTEMPTS = 5;

@Injectable()
export class PaymentsCleanupService {
    private readonly logger = new Logger(PaymentsCleanupService.name);

    constructor(
        @Inject(PAYMENT_PROVIDER)
        private readonly paymentProvider: IPaymentProvider,

        @InjectModel(OrphanedProviderCustomer.name)
        private readonly orphanModel: Model<OrphanedProviderCustomerDocument>
    ) {}

    @Cron(CronExpression.EVERY_DAY_AT_4AM)
    async cleanupOrphanedCustomers(): Promise<void> {
        const orphans = await this.orphanModel
            .find({ attempts: { $lt: MAX_ATTEMPTS } })
            .lean();

        if (orphans.length === 0) {
            return;
        }

        let cleaned = 0;

        for (const orphan of orphans) {
            try {
                await this.paymentProvider.deleteCustomerData(
                    orphan.providerCustomerId
                );
                await this.orphanModel.findByIdAndDelete(orphan._id);
                cleaned++;
            } catch (error) {
                await this.orphanModel.findByIdAndUpdate(orphan._id, {
                    $inc: { attempts: 1 },
                    $set: { lastAttemptAt: new Date() },
                });

                const attempts = orphan.attempts + 1;
                if (attempts >= MAX_ATTEMPTS) {
                    this.logger.error(
                        `Giving up on orphaned customer ${orphan.providerCustomerId} after ${MAX_ATTEMPTS} attempts`,
                        error instanceof Error ? error.stack : String(error)
                    );
                } else {
                    this.logger.warn(
                        `Failed to delete orphaned customer ${orphan.providerCustomerId} (attempt ${attempts}/${MAX_ATTEMPTS})`
                    );
                }
            }
        }

        this.logger.log(
            `Orphaned customer cleanup: ${cleaned}/${orphans.length} deleted`
        );
    }
}
