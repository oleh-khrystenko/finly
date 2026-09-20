import {
    Injectable,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import {
    MAGIC_LINK_PURPOSE,
    RESPONSE_CODE,
    type MagicLinkPurpose,
} from '@finly/types';
import { Resend } from 'resend';

import { ENV } from '../../config/env';
import {
    ACCOUNT_DELETION_GRACE_DAYS,
    ORPHAN_CLEANUP,
} from '../../config/cleanup.config';
import { MagicLinkEmail, getMagicLinkSubject } from './templates/magic-link';
import {
    DeletionConfirmationEmail,
    DELETION_CONFIRMATION_SUBJECT,
} from './templates/deletion-confirmation';
import {
    DeletionReminderEmail,
    DELETION_REMINDER_SUBJECT,
} from './templates/deletion-reminder';
import { ProfileCompletionReminderEmail } from './templates/profile-completion-reminder';
import { ProfileCompletionFinalWarningEmail } from './templates/profile-completion-final-warning';
import {
    SubscriptionPastDueEmail,
    SUBSCRIPTION_PAST_DUE_SUBJECT,
} from './templates/subscription-past-due';
import {
    SubscriptionEndedEmail,
    SUBSCRIPTION_ENDED_SUBJECT,
} from './templates/subscription-ended';
import {
    CardChangedEmail,
    CARD_CHANGED_SUBJECT,
} from './templates/card-changed';
import {
    ManualReviewAlertEmail,
    MANUAL_REVIEW_ALERT_SUBJECT,
    type ManualReviewAlertRow,
} from './templates/manual-review-alert';
import {
    CardRevocationFailedEmail,
    CARD_REVOCATION_FAILED_SUBJECT,
} from './templates/card-revocation-failed';
import { EMAIL_TEXT, PROFILE_COMPLETION_CTA_PATH } from './translations';

const BILLING_CTA_PATH = '/billing';

const DATE_LOCALE = 'uk-UA';

/** Час у листі адміністратора — київський, як у кабінеті monobank. */
const KYIV_TIME_ZONE = 'Europe/Kyiv';

/** Списання, про яке розповідає лист ручного розбору. */
export interface ManualReviewAlertCharge {
    createdAt: Date;
    amount: number; // копійки
    currency: string;
    /** Номер рахунку monobank; `null`, якщо до банку так і не дійшли. */
    invoiceId: string | null;
    orderReference: string;
}

@Injectable()
export class EmailService {
    private readonly logger = new Logger(EmailService.name);
    private readonly resend = new Resend(ENV.RESEND_API_KEY);

    async sendMagicLink(params: {
        email: string;
        token: string;
        purpose: MagicLinkPurpose;
        redirectTo?: string;
    }): Promise<void> {
        const { email, token, purpose, redirectTo } = params;
        const link = this.buildMagicLink(token, purpose, redirectTo);

        await this.send({
            to: email,
            subject: getMagicLinkSubject(purpose),
            react: MagicLinkEmail({ purpose, link }),
        });

        this.logger.log(`Magic link (${purpose}) sent to ${email}`);
    }

    async sendDeletionConfirmation(params: {
        email: string;
        deletionDate: Date;
    }): Promise<void> {
        const { email, deletionDate } = params;

        await this.send({
            to: email,
            subject: DELETION_CONFIRMATION_SUBJECT,
            react: DeletionConfirmationEmail({
                signInUrl: `${ENV.WEB_URL}/auth/signin`,
                formattedDate: this.formatDate(deletionDate),
                graceDays: ACCOUNT_DELETION_GRACE_DAYS,
            }),
        });

        this.logger.log(`Deletion confirmation sent to ${email}`);
    }

    async sendDeletionReminder(params: {
        email: string;
        deletionDate: Date;
    }): Promise<void> {
        const { email, deletionDate } = params;

        await this.send({
            to: email,
            subject: DELETION_REMINDER_SUBJECT,
            react: DeletionReminderEmail({
                signInUrl: `${ENV.WEB_URL}/auth/signin`,
                formattedDate: this.formatDate(deletionDate),
            }),
        });

        this.logger.log(`Deletion reminder sent to ${email}`);
    }

    async sendProfileCompletionReminder(params: {
        user: { email: string };
        businesses: ReadonlyArray<{ name: string }>;
    }): Promise<void> {
        const { user, businesses } = params;
        const mapped = businesses.map((b) => ({ name: b.name }));
        const copy = EMAIL_TEXT.profileCompletion.reminder;
        const subject =
            mapped.length === 1 ? copy.singleSubject : copy.multiSubject;

        await this.send({
            to: user.email,
            subject,
            react: ProfileCompletionReminderEmail({
                businesses: mapped,
                deletionDays: ORPHAN_CLEANUP.deletionDays,
                ctaHref: `${ENV.WEB_URL}${PROFILE_COMPLETION_CTA_PATH}`,
            }),
        });

        this.logger.log(`Profile completion reminder sent to ${user.email}`);
    }

    async sendProfileCompletionFinalWarning(params: {
        user: { email: string };
        businesses: ReadonlyArray<{ name: string }>;
    }): Promise<void> {
        const { user, businesses } = params;
        const mapped = businesses.map((b) => ({ name: b.name }));
        const copy = EMAIL_TEXT.profileCompletion.finalWarning;
        const subject =
            mapped.length === 1 ? copy.singleSubject : copy.multiSubject;

        await this.send({
            to: user.email,
            subject,
            react: ProfileCompletionFinalWarningEmail({
                businesses: mapped,
                ctaHref: `${ENV.WEB_URL}${PROFILE_COMPLETION_CTA_PATH}`,
            }),
        });

        this.logger.log(
            `Profile completion final warning sent to ${user.email}`
        );
    }

    /** Sprint 22 — лист прострочки dunning (доступ ще живий, є грейс-вікно). */
    async sendSubscriptionPastDue(params: {
        email: string;
        planName: string;
        amount: number; // копійки
        currency: string;
        attempt: number;
        maxAttempts: number;
    }): Promise<void> {
        const { email, planName, amount, currency, attempt, maxAttempts } =
            params;
        await this.send({
            to: email,
            subject: SUBSCRIPTION_PAST_DUE_SUBJECT,
            react: SubscriptionPastDueEmail({
                planName,
                amountLabel: formatAmount(amount, currency),
                attempt,
                maxAttempts,
                billingUrl: `${ENV.WEB_URL}${BILLING_CTA_PATH}`,
            }),
        });
        this.logger.log(`Subscription past-due notice sent to ${email}`);
    }

    /** Sprint 22 — лист про зняття доступу після вичерпання грейсу dunning. */
    async sendSubscriptionEnded(params: {
        email: string;
        planName: string;
    }): Promise<void> {
        const { email, planName } = params;
        await this.send({
            to: email,
            subject: SUBSCRIPTION_ENDED_SUBJECT,
            react: SubscriptionEndedEmail({
                planName,
                billingUrl: `${ENV.WEB_URL}${BILLING_CTA_PATH}`,
            }),
        });
        this.logger.log(`Subscription ended notice sent to ${email}`);
    }

    /**
     * Sprint 43 — сповіщення про зміну платіжної картки. Безпекове за суттю:
     * підміна картки одна з перших дій того, хто дістався чужого кабінету.
     */
    async sendCardChanged(params: {
        email: string;
        cardLabel: string | null;
    }): Promise<void> {
        const { email, cardLabel } = params;
        await this.send({
            to: email,
            subject: CARD_CHANGED_SUBJECT,
            react: CardChangedEmail({
                cardLabel,
                billingUrl: `${ENV.WEB_URL}${BILLING_CTA_PATH}`,
            }),
        });
        this.logger.log(`Card changed notice sent to ${email}`);
    }

    /**
     * Sprint 43 — лист адміністраторові про платіж, що потребує ручного
     * розбору. Єдиний активний сигнал про такі платежі: прапорець у профілі і
     * рядок у лозі самі нікого не будять.
     */
    async sendManualReviewAlert(params: {
        userId: string;
        userEmail: string | null;
        stillFlagged: boolean;
        unmatched: ManualReviewAlertCharge[];
        unsettled: ManualReviewAlertCharge[];
    }): Promise<void> {
        const { userId, userEmail, stillFlagged, unmatched, unsettled } =
            params;
        await this.send({
            to: ENV.OPS_ALERT_EMAIL,
            subject: MANUAL_REVIEW_ALERT_SUBJECT,
            react: ManualReviewAlertEmail({
                userId,
                userEmail,
                stillFlagged,
                unmatched: unmatched.map((c) => this.toAlertRow(c)),
                unsettled: unsettled.map((c) => this.toAlertRow(c)),
            }),
        });
        this.logger.log(`Manual review alert sent for user ${userId}`);
    }

    /**
     * Sprint 43 — лист адміністраторові про картку, яку так і не вдалося
     * відкликати у гаманці monobank. Спроби припинено свідомо: далі черга
     * відкликань тримала б білінг-профіль живим безстроково, а з ним зависало б
     * і остаточне видалення акаунта. Ціна відступу — картка лишається в
     * гаманці, тож прибрати її руками має людина.
     */
    async sendCardRevocationFailed(params: {
        userId: string;
        walletId: string | null;
        attempts: number;
    }): Promise<void> {
        const { userId, walletId, attempts } = params;
        await this.send({
            to: ENV.OPS_ALERT_EMAIL,
            subject: CARD_REVOCATION_FAILED_SUBJECT,
            react: CardRevocationFailedEmail({ userId, walletId, attempts }),
        });
        this.logger.log(`Card revocation alert sent for user ${userId}`);
    }

    private toAlertRow(charge: ManualReviewAlertCharge): ManualReviewAlertRow {
        return {
            whenLabel: charge.createdAt.toLocaleString(DATE_LOCALE, {
                timeZone: KYIV_TIME_ZONE,
                dateStyle: 'medium',
                timeStyle: 'short',
            }),
            amountLabel: formatAmount(charge.amount, charge.currency),
            referenceLabel: charge.invoiceId
                ? `рахунок monobank ${charge.invoiceId}`
                : `спроба ${charge.orderReference}, до банку не дійшла`,
        };
    }

    private formatDate(date: Date): string {
        return date.toLocaleDateString(DATE_LOCALE, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    }

    private async send(options: {
        to: string;
        subject: string;
        react: React.JSX.Element;
    }): Promise<void> {
        const { error } = await this.resend.emails.send({
            from: ENV.RESEND_FROM_EMAIL,
            ...options,
        });

        if (error) {
            this.logger.error(
                `Failed to send email to ${options.to}: ${error.message}`
            );
            throw new InternalServerErrorException({
                code: RESPONSE_CODE.EMAIL_SEND_FAILED,
                message: `Failed to send email: ${error.message}`,
            });
        }
    }

    private buildMagicLink(
        token: string,
        purpose: MagicLinkPurpose,
        redirectTo?: string
    ): string {
        let link =
            purpose === MAGIC_LINK_PURPOSE.RESET_PASSWORD
                ? `${ENV.WEB_URL}/auth/reset-password?token=${token}`
                : `${ENV.WEB_URL}/auth/verify?token=${token}`;

        if (redirectTo && purpose !== MAGIC_LINK_PURPOSE.RESET_PASSWORD) {
            link += `&redirect=${encodeURIComponent(redirectTo)}`;
        }

        return link;
    }
}

/** Копійки → людська сума з гривневою позначкою (₴ у копії — «грн»). */
function formatAmount(kopecks: number, currency: string): string {
    const value = kopecks / 100;
    const rounded = Number.isInteger(value)
        ? value.toString()
        : value.toFixed(2);
    return currency === 'UAH' ? `${rounded} грн` : `${rounded} ${currency}`;
}
