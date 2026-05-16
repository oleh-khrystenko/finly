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
import { EMAIL_TEXT, PROFILE_COMPLETION_CTA_PATH } from './translations';

const DATE_LOCALE = 'uk-UA';

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
                graceDays: ENV.ACCOUNT_DELETION_GRACE_DAYS,
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
                deletionDays: ENV.ORPHAN_CLEANUP_DELETION_DAYS,
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
