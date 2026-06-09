import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
    PAYMENT_RECORD_STATUS,
    PAYMENT_RECORD_TYPE,
    type PaymentRecordStatus,
    type PaymentRecordType,
} from '@finly/types';

export type PaymentRecordDocument = HydratedDocument<PaymentRecord>;

export type PaymentRecordLean = PaymentRecord & { _id: Types.ObjectId };

/**
 * Sprint 17 — легка колекція грошових списань. Джерело історії для кабінету
 * (останні N) і для refund (запис, який повертаємо). Наповнюється з вебхуків
 * WayForPay. Містить provider-internal поля (`orderReference`,
 * `providerTransactionId`), тож у frontend мапиться явно через
 * `PaymentRecordSchema` (не через toJSON) — як ledger `ExecutionTransaction`.
 *
 * `amount`/`refundAmount` — копійки-integer (доменний інваріант); конверсію
 * у decimal для WayForPay робить payload-mapper провайдера.
 */
@Schema({ timestamps: true })
export class PaymentRecord {
    @Prop({ required: true, type: Types.ObjectId })
    userId!: Types.ObjectId;

    @Prop({ required: true })
    orderReference!: string;

    @Prop({
        required: true,
        enum: Object.values(PAYMENT_RECORD_TYPE),
    })
    type!: PaymentRecordType;

    @Prop({ required: true })
    amount!: number;

    @Prop({ required: true })
    currency!: string;

    @Prop({
        required: true,
        enum: Object.values(PAYMENT_RECORD_STATUS),
        default: PAYMENT_RECORD_STATUS.PENDING,
    })
    status!: PaymentRecordStatus;

    @Prop({ type: String, default: null })
    providerTransactionId!: string | null;

    @Prop({ type: String, default: null })
    cardMask!: string | null;

    @Prop({ type: Number, default: null })
    refundAmount!: number | null;

    // Declared for TypeScript visibility; managed by Mongoose timestamps: true.
    createdAt!: Date;
}

export const PaymentRecordSchema = SchemaFactory.createForClass(PaymentRecord);

PaymentRecordSchema.index({ userId: 1, createdAt: -1 });
PaymentRecordSchema.index({ providerTransactionId: 1 }, { sparse: true });
