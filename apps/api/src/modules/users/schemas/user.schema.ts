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
class UserExecutions {
    @Prop({ required: true, default: 0, min: 0 })
    balance!: number;

    @Prop({ required: true, default: false })
    freeReportUsed!: boolean;
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

    @Prop({
        type: UserExecutions,
        default: () => ({
            balance: 0,
            freeReportUsed: false,
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

    /**
     * Sprint 17 — WayForPay білінг. WayForPay не має customer-обʼєкта: підписку
     * ідентифікуємо власним `orderReference`. `recToken` — secret-токен картки
     * для ad-hoc `Charge` (proration-доплата при апгрейді); НІКОЛИ не
     * серіалізується у frontend (mapper явно його не вибирає). `cardMask` —
     * останні цифри картки для відображення. `providerSubscriptionStatus`
     * тримає raw lifecycle WayForPay (Active/Suspended/Removed/...).
     */
    @Prop({
        type: {
            provider: { type: String, default: null },
            orderReference: { type: String, default: null },
            recToken: { type: String, default: null },
            cardMask: { type: String, default: null },
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
            rebindPendingAt: { type: Date, default: null },
            oneOffLevel: { type: String, default: null },
            oneOffAccessUntil: { type: Date, default: null },
            oneOffOrderReference: { type: String, default: null },
        },
        default: null,
        _id: false,
    })
    billing!: {
        provider: string | null;
        orderReference: string | null;
        recToken: string | null;
        cardMask: string | null;
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
        /**
         * Set when `updateCard` tears down the old recurring and awaits a new
         * card binding; cleared by the first approved webhook on the new
         * orderReference. Lets the cleanup cron expire abandoned re-binds whose
         * period already lapsed (old recurring gone, new one never confirmed),
         * instead of leaving `hasActiveSubscription` true indefinitely.
         */
        rebindPendingAt: Date | null;
        /**
         * Sprint 19 — орендований one-off доступ: рівень (`brand`/`bookkeeper`)
         * + дата закінчення. Не залежить від підписки; гасне ліниво на read
         * (`deriveAccessLevel` звіряє дату). Підписка і one-off живуть у тому
         * самому субдоці, рівень доступу = максимум обох.
         */
        oneOffLevel: string | null;
        oneOffAccessUntil: Date | null;
        /**
         * orderReference покупки, що тримає чинний one-off-слот. Refund-вебхук
         * гасить доступ лише при збігу — повернення грошей за старішу покупку
         * (слот уже перезаписано новішою) не зачіпає чинний оплачений доступ.
         */
        oneOffOrderReference: string | null;
    } | null;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ 'provider.id': 1 }, { sparse: true });
UserSchema.index({ 'billing.orderReference': 1 }, { sparse: true });
// Sprint 19 — cron сплину one-off шукає активні one-off із датою у минулому.
UserSchema.index({ 'billing.oneOffAccessUntil': 1 }, { sparse: true });
