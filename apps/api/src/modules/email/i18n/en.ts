import { MAGIC_LINK_PURPOSE } from '@neatslip/types';

import type { EmailTranslations } from './types';

export const en = {
    magicLink: {
        [MAGIC_LINK_PURPOSE.LOGIN]: {
            subject: 'Your sign-in link for NeatSlip',
            body: 'We received a sign-in request for your account. Use the button below to continue.',
            cta: 'Sign In',
            footer: "This link expires in 15 minutes. If you didn't request this, you can safely ignore this email.",
        },
        [MAGIC_LINK_PURPOSE.REGISTER]: {
            subject: 'Welcome to NeatSlip',
            body: 'Thank you for signing up. Use the button below to complete your registration.',
            cta: 'Complete Registration',
            footer: "This link expires in 15 minutes. If you didn't create an account, you can safely ignore this email.",
        },
        [MAGIC_LINK_PURPOSE.RESET_PASSWORD]: {
            subject: 'Reset your NeatSlip password',
            body: 'We received a password reset request for your account. Use the button below to set a new password.',
            cta: 'Reset Password',
            footer: "This link expires in 15 minutes. If you didn't request this, your password remains unchanged — no action needed.",
        },
        [MAGIC_LINK_PURPOSE.DELETE_ACCOUNT]: {
            subject: 'Confirm account deletion',
            body: 'We received a request to delete your NeatSlip account. Use the button below to confirm.',
            cta: 'Confirm Deletion',
            footer: "This link expires in 15 minutes. If you didn't request this, you can safely ignore this email — your account will not be affected.",
        },
    },
    deletionConfirmation: {
        subject: 'Your NeatSlip account has been deactivated',
        body: (formattedDate: string) =>
            `Your account has been deactivated as requested. All data will be permanently deleted on ${formattedDate}.`,
        instruction: (graceDays: number) =>
            `Changed your mind? Simply sign in within ${graceDays} ${graceDays === 1 ? 'day' : 'days'} to restore your account.`,
        cta: 'Sign In',
        footer: "If you didn't request this, please sign in immediately to secure your account.",
    },
    deletionReminder: {
        subject: 'Reminder: your account will be deleted tomorrow',
        body: (formattedDate: string) =>
            `We wanted to remind you that your NeatSlip account is scheduled for permanent deletion on ${formattedDate}.`,
        instruction:
            "If you'd like to keep your account, simply sign in before then.",
        cta: 'Sign In',
        footer: "If you didn't request deletion, please sign in immediately to secure your account.",
    },
} satisfies EmailTranslations;
