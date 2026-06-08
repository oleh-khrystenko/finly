import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ExecutionTransactionDocument =
    HydratedDocument<ExecutionTransaction>;

export type ExecutionTransactionLean = ExecutionTransaction & {
    _id: Types.ObjectId;
};

@Schema({ timestamps: true })
export class ExecutionTransaction {
    @Prop({ required: true, type: Types.ObjectId })
    userId!: Types.ObjectId;

    @Prop({ required: true, enum: ['credit', 'debit'] })
    type!: string;

    @Prop({ required: true })
    action!: string;

    @Prop({ required: true, min: 1 })
    amount!: number;

    @Prop({ required: true, min: 0 })
    balanceAfter!: number;

    // Declared for TypeScript visibility; managed by Mongoose timestamps: true.
    createdAt!: Date;
}

export const ExecutionTransactionSchema =
    SchemaFactory.createForClass(ExecutionTransaction);

ExecutionTransactionSchema.index({ userId: 1, createdAt: -1 });
