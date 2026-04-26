import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import {
    BRIEF_STATUS,
    type BriefStatus,
    type BriefBudget,
    type BriefDeadline,
} from '@cyanship/types';

@Schema({ timestamps: true, collection: 'briefs' })
export class Brief extends Document {
    @Prop({ required: true, trim: true })
    name!: string;

    @Prop({ required: true, trim: true, lowercase: true })
    email!: string;

    @Prop({ required: true, trim: true })
    description!: string;

    @Prop({ type: String, required: true })
    budget!: BriefBudget;

    @Prop({ type: String, default: null })
    deadline!: BriefDeadline | null;

    @Prop({ type: String, default: null })
    source!: string | null;

    @Prop({ type: String, default: null })
    lang!: string | null;

    @Prop({ type: String, default: BRIEF_STATUS.NEW, index: true })
    status!: BriefStatus;

    @Prop({ type: Boolean, default: false })
    requestAiBonus!: boolean;

    @Prop({ type: Types.ObjectId, default: null })
    userId!: Types.ObjectId | null;

    // timestamps: true дає createdAt, updatedAt
    createdAt!: Date;
    updatedAt!: Date;
}

export const BriefSchema = SchemaFactory.createForClass(Brief);
