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
     * Sprint 22 — monobank білінг під керуванням нашого коду. monobank не має
     * рекуренту: тяглість підписки тримає НАШ запис, не провайдер. `cardToken` —
     * secret-токен картки monobank, за яким billing-clock списує всі продовження;
     * НІКОЛИ не серіалізується у frontend (mapper явно його не вибирає).
     * `walletId` — стабільний per-user гаманець monobank для токенізації.
     * `nextChargeAt` — вісь планувальника (активна підписка завжди має її в
     * майбутньому). `dunningAttempts`/`nextRetryAt` — стан прострочки (серія
     * повторних спроб у межах грейсу). `cardMask` — маска для відображення.
     */
    @Prop({
        type: {
            provider: { type: String, default: null },
            cardToken: { type: String, default: null },
            walletId: { type: String, default: null },
            cardMask: { type: String, default: null },
            planCode: { type: String, default: null },
            currency: { type: String, default: null },
            subscriptionStatus: { type: String, default: null },
            currentPeriodEnd: { type: Date, default: null },
            nextChargeAt: { type: Date, default: null },
            cancelAtPeriodEnd: { type: Boolean, default: false },
            hasActiveSubscription: { type: Boolean, default: false },
            lastProviderEventAt: { type: Date, default: null },
            dunningAttempts: { type: Number, default: 0 },
            nextRetryAt: { type: Date, default: null },
            needsManualReview: { type: Boolean, default: false },
            oneOffLevel: { type: String, default: null },
            oneOffAccessUntil: { type: Date, default: null },
            oneOffOrderReference: { type: String, default: null },
            reconcileRequiredAt: { type: Date, default: null },
        },
        default: null,
        _id: false,
    })
    billing!: {
        provider: string | null;
        /** Secret-токен картки monobank — веде всі продовження. Не у frontend. */
        cardToken: string | null;
        /** Стабільний per-user гаманець monobank для захоплення/перевикористання токена. */
        walletId: string | null;
        cardMask: string | null;
        planCode: string | null;
        currency: string | null;
        subscriptionStatus: string | null;
        currentPeriodEnd: Date | null;
        /**
         * Дата наступного списання нашим billing-clock. Активна підписка завжди
         * має визначену дату в майбутньому; скасування і зняття доступу її
         * прибирають (null = планувальник підписку не чіпає).
         */
        nextChargeAt: Date | null;
        cancelAtPeriodEnd: boolean;
        hasActiveSubscription: boolean;
        lastProviderEventAt: Date | null;
        /** Лічильник невдалих спроб списання у поточній прострочці (0 коли ACTIVE). */
        dunningAttempts: number;
        /** Час наступної повторної спроби dunning (null поза прострочкою). */
        nextRetryAt: Date | null;
        /**
         * Durable-прапор для ops: списання дало нерозвʼязний результат (невідомо,
         * чи рухались гроші). Планувальник зупинено (`nextChargeAt=null`), доступ
         * збережено; знімається успішною активацією/продовженням або руками ops.
         * Опційне: присутнє лише коли виставлене (sparse за замовчуванням).
         */
        needsManualReview?: boolean;
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
        /**
         * Sprint 19 — durable-маркер незавершеної реконсиляції бізнесів.
         * Стемпиться cleanup-cron-ом при флипі доступу (щоб відкладений через
         * lock-contention reconcile не загубився разом зі своїм тригером) і
         * самою реконсиляцією, коли slug-rent не вмістився у батч-ліміт.
         * Знімається `ReconciliationService.reconcile` після повного проходу.
         * Daily-sweep (`PaymentsCleanupService.retryPendingReconciles`) добиває
         * стемпнутих.
         */
        reconcileRequiredAt: Date | null;
    } | null;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ 'provider.id': 1 }, { sparse: true });
// Sprint 19 — cron сплину one-off шукає активні one-off із датою у минулому.
UserSchema.index({ 'billing.oneOffAccessUntil': 1 }, { sparse: true });
// Sprint 22 — billing-clock шукає підписки з насталою датою списання / повтору.
UserSchema.index({ 'billing.nextChargeAt': 1 }, { sparse: true });
UserSchema.index({ 'billing.nextRetryAt': 1 }, { sparse: true });
