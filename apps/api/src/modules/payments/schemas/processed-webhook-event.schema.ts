import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ProcessedWebhookEventDocument =
    HydratedDocument<ProcessedWebhookEvent>;

@Schema({ timestamps: false })
export class ProcessedWebhookEvent {
    @Prop({ required: true })
    provider!: string;

    @Prop({ required: true })
    providerEventId!: string;

    @Prop({ required: true })
    receivedAt!: Date;

    @Prop({ required: true })
    occurredAt!: Date;

    @Prop({ required: true })
    type!: string;

    @Prop({ type: String, default: null })
    userId!: string | null;

    @Prop({ type: String, default: null })
    oneOffCode!: string | null;

    @Prop({ required: true, default: 'pending' })
    status!: 'pending' | 'applied';
}

export const ProcessedWebhookEventSchema = SchemaFactory.createForClass(
    ProcessedWebhookEvent
);

ProcessedWebhookEventSchema.index(
    { provider: 1, providerEventId: 1 },
    { unique: true }
);

// Sprint 32 — остаточне прибирання акаунта забирає і журнал платіжних подій
// платника. Partial, а не sparse: дефолт поля — `null`, тобто присутнє
// значення, і sparse-index усе одно тримав би кожну подію без адресата.
ProcessedWebhookEventSchema.index(
    { userId: 1 },
    { partialFilterExpression: { userId: { $type: 'string' } } }
);
