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
class ProfileCompletionReminders {
    @Prop({ type: Date, default: null })
    firstReminderSentAt!: Date | null;

    @Prop({ type: Date, default: null })
    finalWarningSentAt!: Date | null;
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

    /**
     * Sprint 11 — single-stamp post-login deep-link target. Write-once на
     * `LandingClaimService` success-claim, consume-and-clear на verify-handler
     * (same-device) АБО `AuthInitializer` (cold-login resume). Більшість юзерів
     * ніколи не торкають це поле, тож sparse-by-default; окремий index не
     * додаємо — поле читається тільки через per-user `getMe()`-flow, без
     * queries-by-target.
     */
    @Prop({ type: String, required: false })
    pendingPostLoginTarget?: string;

    /**
     * Sprint 12 — 3-stage orphan-cleanup email-pipeline stamps. Cron-only read
     * path, без queries-by-stamp → index не потрібен. Factory-default обох-null
     * на insert; cron оновлює через atomic `findOneAndUpdate` з conditional-
     * filter (claim-first pattern). Field-path-и (`...firstReminderSentAt`,
     * `...finalWarningSentAt`) — частина public-API сервіс-методів і aggregation
     * pipeline cron-а; перейменування ламає обидва.
     */
    @Prop({
        type: ProfileCompletionReminders,
        default: () => ({
            firstReminderSentAt: null,
            finalWarningSentAt: null,
        }),
    })
    profileCompletionReminders!: ProfileCompletionReminders;

    @Prop()
    lastLoginAt?: Date;

    // Sprint 27 — вбудований `billing`-субдок знято: білінг переїхав у окрему
    // сутність `BillingProfile` (payments-модуль). На користувачі білінгу немає.
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ 'provider.id': 1 }, { sparse: true });
