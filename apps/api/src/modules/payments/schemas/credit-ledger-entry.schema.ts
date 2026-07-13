import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
    CREDIT_LEDGER_ENTRY_TYPE,
    type CreditLedgerEntryType,
} from '@finly/types';

export type CreditLedgerEntryDocument = HydratedDocument<CreditLedgerEntry>;

export type CreditLedgerEntryLean = CreditLedgerEntry & {
    _id: Types.ObjectId;
};

/**
 * Sprint 27 — append-only книга операцій кредитного рахунку. Веде кожну зміну
 * балансу: місячний top-up-to-cap, докупівлю прихованим пакетом, майбутні
 * списання за AI-обробку і ренту сховища. Ніколи не оновлюється після вставки
 * (append-only інваріант).
 *
 * `idempotencyKey` — унікальний ключ операції (напр. `topup:<userId>:<epoch
 * межі циклу>` або `purchase:<orderReference>`): гарантує, що повторний прохід
 * billing-clock / повторний вебхук не нарахує кредити двічі. `costUsdMicros` —
 * фактична собівартість у мільйонних долара (для PROCESSING; null для нарахувань):
 * книга веде реальну вартість незалежно від активної моделі показу кредитів.
 */
@Schema({ timestamps: true })
export class CreditLedgerEntry {
    @Prop({ required: true, type: Types.ObjectId })
    userId!: Types.ObjectId;

    @Prop({
        required: true,
        enum: Object.values(CREDIT_LEDGER_ENTRY_TYPE),
    })
    type!: CreditLedgerEntryType;

    /** Знакова зміна балансу: нарахування додатне, списання від'ємне. */
    @Prop({ required: true })
    credits!: number;

    /** Баланс після застосування цієї операції. */
    @Prop({ required: true, min: 0 })
    balanceAfter!: number;

    /** Фактична собівартість у мільйонних долара (PROCESSING); null для решти. */
    @Prop({ type: Number, default: null })
    costUsdMicros!: number | null;

    /** orderReference грошового списання (TOP_UP / PURCHASE); null для решти. */
    @Prop({ type: String, default: null })
    paymentReference!: string | null;

    /** Документ, за обробку якого списано (PROCESSING); null для решти. */
    @Prop({ type: Types.ObjectId, default: null })
    documentId!: Types.ObjectId | null;

    /** Унікальний ключ операції — захист від подвійного нарахування. */
    @Prop({ required: true })
    idempotencyKey!: string;

    // Declared for TypeScript visibility; managed by Mongoose timestamps: true.
    createdAt!: Date;
}

export const CreditLedgerEntrySchema =
    SchemaFactory.createForClass(CreditLedgerEntry);

// Книга кабінету: операції платника за спаданням дати.
CreditLedgerEntrySchema.index({ userId: 1, createdAt: -1 });
// Ідемпотентність нарахувань/докупівель: один запис на ключ операції.
CreditLedgerEntrySchema.index({ idempotencyKey: 1 }, { unique: true });
