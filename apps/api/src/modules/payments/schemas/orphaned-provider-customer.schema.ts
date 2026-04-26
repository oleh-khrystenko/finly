import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OrphanedProviderCustomerDocument =
    HydratedDocument<OrphanedProviderCustomer>;

@Schema({ timestamps: false })
export class OrphanedProviderCustomer {
    @Prop({ required: true })
    provider!: string;

    @Prop({ required: true })
    providerCustomerId!: string;

    @Prop({ required: true })
    reason!: string;

    @Prop({ required: true })
    failedAt!: Date;

    @Prop({ required: true, default: 0 })
    attempts!: number;

    @Prop({ type: Date, default: null })
    lastAttemptAt!: Date | null;
}

export const OrphanedProviderCustomerSchema = SchemaFactory.createForClass(
    OrphanedProviderCustomer
);

OrphanedProviderCustomerSchema.index(
    { provider: 1, providerCustomerId: 1 },
    { unique: true }
);
