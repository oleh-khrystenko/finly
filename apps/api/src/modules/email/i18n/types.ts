import type { MagicLinkPurpose } from '@neatslip/types';

export interface MagicLinkTranslations {
    subject: string;
    body: string;
    cta: string;
    footer: string;
}

export interface DeletionConfirmationTranslations {
    subject: string;
    body: (formattedDate: string) => string;
    instruction: (graceDays: number) => string;
    cta: string;
    footer: string;
}

export interface DeletionReminderTranslations {
    subject: string;
    body: (formattedDate: string) => string;
    instruction: string;
    cta: string;
    footer: string;
}

export interface EmailTranslations {
    magicLink: Record<MagicLinkPurpose, MagicLinkTranslations>;
    deletionConfirmation: DeletionConfirmationTranslations;
    deletionReminder: DeletionReminderTranslations;
}
