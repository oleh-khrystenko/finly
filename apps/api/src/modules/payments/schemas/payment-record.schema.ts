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
 * Sprint 17/22 — легка колекція грошових списань. Джерело історії для кабінету
 * (останні N) і claim-first запис спроби billing-clock: PENDING-рядок
 * створюється ДО виклику monobank, унікальний індекс (orderReference у статусі
 * pending) гарантує одну спробу на період — повторний прохід cron-а не списує
 * вдруге, а звіряє статус. `providerTransactionId` тримає monobank `invoiceId`
 * (ключ для запиту статусу). Містить provider-internal поля, тож у frontend
 * мапиться явно через `PaymentRecordSchema` (не через toJSON).
 *
 * `amount`/`refundAmount` — копійки-integer (доменний інваріант; monobank оперує
 * мінорними одиницями напряму, конверсії немає).
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

    /**
     * Sprint 27 — відкладений ефект для негайних token-списань (пропорція /
     * докупівля кредитів), якщо провайдер повернув НЕтермінальний результат:
     * ефект (нова ємність складу + нарахування кредитів) застосовується при
     * фіналізації статусу billing-clock-reconcile, а не синхронно. `null` для
     * циклових/checkout-списань (їх ефект детермінований reference-ом / станом).
     * Ідемпотентність нарахування кредитів тримає `idempotencyKey` книги
     * (= orderReference), тож повторна фіналізація не подвоїть баланс.
     */
    @Prop({
        type: {
            universe: { type: String, required: true },
            targetCapacity: { type: Number, default: null },
            targetTierSize: { type: Number, default: null },
            grantCredits: { type: Number, default: 0 },
            attachBusinessId: { type: String, default: null },
        },
        default: null,
        _id: false,
    })
    pendingEffect!: {
        universe: string;
        targetCapacity: number | null;
        targetTierSize: number | null;
        grantCredits: number;
        /** Бізнес, що атомарно заповнює новий слот при застосуванні ефекту. */
        attachBusinessId: string | null;
    } | null;

    // Declared for TypeScript visibility; managed by Mongoose timestamps: true.
    createdAt!: Date;
}

export const PaymentRecordSchema = SchemaFactory.createForClass(PaymentRecord);

PaymentRecordSchema.index({ userId: 1, createdAt: -1 });
PaymentRecordSchema.index({ providerTransactionId: 1 }, { sparse: true });
// Claim-first: щонайбільше один PENDING-запис на reference. Конкурентний/
// повторний прохід billing-clock натикається на 11000 і йде шляхом звірки
// статусу замість повторного списання.
PaymentRecordSchema.index(
    { orderReference: 1 },
    {
        unique: true,
        partialFilterExpression: { status: PAYMENT_RECORD_STATUS.PENDING },
    }
);
