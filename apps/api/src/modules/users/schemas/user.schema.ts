import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { DEFAULT_USER_ROLE, USER_ROLES, type UserRole } from '@finly/types';

export type UserDocument = HydratedDocument<User>;

@Schema({ _id: false })
class UserProvider {
    @Prop({ required: true })
    name!: string;

    @Prop({ required: true })
    id!: string;
}

@Schema({ _id: false })
class UserProfileData {
    @Prop()
    firstName?: string;

    @Prop()
    lastName?: string;

    @Prop()
    avatar?: string;
}

@Schema({ _id: false })
class CompensationOps {
    @Prop({ type: Object, default: {} })
    inc!: Record<string, number>;
}

@Schema({ _id: false })
class ActiveReservation {
    @Prop({ required: true })
    id!: string;

    @Prop({ required: true, min: 1 })
    amount!: number;

    @Prop({ required: true })
    reservedAt!: Date;

    @Prop({ required: true })
    expiresAt!: Date;

    @Prop({ required: true })
    feature!: string;

    @Prop({ type: CompensationOps, required: true })
    compensationOps!: CompensationOps;
}

@Schema({ _id: false })
class UserExecutions {
    @Prop({ required: true, default: 0, min: 0 })
    balance!: number;

    @Prop({ required: true, default: false })
    freeReportUsed!: boolean;

    @Prop({ type: ActiveReservation, default: null })
    activeReservation!: ActiveReservation | null;
}

@Schema({ timestamps: true })
export class User {
    @Prop({ required: true, unique: true, lowercase: true, trim: true })
    email!: string;

    /**
     * System-level role. "Гість" свідомо не у БД (це стан "немає JWT").
     * Default спрацьовує лише для нових документів — legacy users без поля
     * нормалізуються на read-time у controller-helper'і `mapUserToProfileResponse`.
     */
    @Prop({
        type: String,
        enum: USER_ROLES,
        default: DEFAULT_USER_ROLE,
        required: true,
    })
    role!: UserRole;

    /**
     * "Режим бухгалтера" — capability на акаунті, не окрема роль. Toggle-логіка
     * (вплив на форму створення Business) — Sprint 3.
     */
    @Prop({ type: Boolean, default: false, required: true })
    worksAsBookkeeper!: boolean;

    @Prop({ type: UserProvider })
    provider?: UserProvider;

    @Prop({ type: UserProfileData, default: () => ({}) })
    profile!: UserProfileData;

    @Prop({
        type: UserExecutions,
        default: () => ({
            balance: 0,
            freeReportUsed: false,
            activeReservation: null,
        }),
    })
    executions!: UserExecutions;

    @Prop({ type: String, default: null })
    passwordHash!: string | null;

    @Prop({ type: Date, default: null })
    deletedAt!: Date | null;

    @Prop({ type: Date, default: null })
    accountDeletionRequestedAt!: Date | null;

    @Prop({ type: Date, default: null })
    deletionReminderSentAt!: Date | null;

    @Prop({ type: String, default: null })
    timezone!: string | null;

    @Prop({ type: Date, default: null })
    termsAcceptedAt!: Date | null;

    @Prop({ type: String, default: null })
    termsVersion!: string | null;

    @Prop()
    lastLoginAt?: Date;

    @Prop({
        type: {
            provider: { type: String, default: null },
            providerCustomerId: { type: String, default: null },
            providerSubscriptionId: { type: String, default: null },
            planCode: { type: String, default: null },
            currency: { type: String, default: null },
            subscriptionStatus: { type: String, default: null },
            providerSubscriptionStatus: { type: String, default: null },
            currentPeriodEnd: { type: Date, default: null },
            cancelAtPeriodEnd: { type: Boolean, default: false },
            hasActiveSubscription: { type: Boolean, default: false },
            lastProviderEventAt: { type: Date, default: null },
            scheduledPlanCode: { type: String, default: null },
            scheduledChangeDate: { type: Date, default: null },
        },
        default: null,
        _id: false,
    })
    billing!: {
        provider: string | null;
        providerCustomerId: string | null;
        providerSubscriptionId: string | null;
        planCode: string | null;
        currency: string | null;
        subscriptionStatus: string | null;
        providerSubscriptionStatus: string | null;
        currentPeriodEnd: Date | null;
        cancelAtPeriodEnd: boolean;
        hasActiveSubscription: boolean;
        lastProviderEventAt: Date | null;
        scheduledPlanCode: string | null;
        scheduledChangeDate: Date | null;
    } | null;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ 'provider.id': 1 }, { sparse: true });
UserSchema.index({ 'billing.providerCustomerId': 1 }, { sparse: true });
UserSchema.index({ 'billing.providerSubscriptionId': 1 }, { sparse: true });
UserSchema.index(
    { 'executions.activeReservation.expiresAt': 1 },
    { sparse: true }
);
