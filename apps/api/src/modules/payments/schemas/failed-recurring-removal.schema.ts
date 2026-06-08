import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FailedRecurringRemovalDocument =
    HydratedDocument<FailedRecurringRemoval>;

/**
 * Sprint 17 — черга повторних спроб WayForPay `REMOVE` рекуренту, коли скидання
 * білінгу не змогло синхронно зняти підписку. Без ретраю залишений рекурент
 * продовжував би списувати кошти. Cron (`PaymentsCleanupService`) добиває їх.
 * (Раніше — `OrphanedProviderCustomer` для Stripe-customer-ів.)
 */
@Schema({ timestamps: false })
export class FailedRecurringRemoval {
    @Prop({ required: true })
    provider!: string;

    @Prop({ required: true })
    orderReference!: string;

    @Prop({ required: true })
    reason!: string;

    @Prop({ required: true })
    failedAt!: Date;

    @Prop({ required: true, default: 0 })
    attempts!: number;

    @Prop({ type: Date, default: null })
    lastAttemptAt!: Date | null;
}

export const FailedRecurringRemovalSchema = SchemaFactory.createForClass(
    FailedRecurringRemoval
);

FailedRecurringRemovalSchema.index(
    { provider: 1, orderReference: 1 },
    { unique: true }
);
