import { Button, Text } from '@react-email/components';
import { EMAIL_COLORS } from '@finly/types';

import { BaseLayout } from './layouts/base';

export const DELETION_REMINDER_SUBJECT =
    'Нагадування: ваш акаунт буде видалено завтра';

const INSTRUCTION =
    'Якщо ви хочете зберегти акаунт, просто увійдіть до цієї дати.';
const CTA = 'Увійти';
const FOOTER =
    'Якщо ви не запитували видалення, негайно увійдіть у свій акаунт для його захисту.';

function buildBody(formattedDate: string): string {
    return `Нагадуємо, що ваш акаунт Finly буде остаточно видалено ${formattedDate}.`;
}

interface DeletionReminderEmailProps {
    signInUrl: string;
    formattedDate: string;
}

export function DeletionReminderEmail({
    signInUrl,
    formattedDate,
}: DeletionReminderEmailProps) {
    return (
        <BaseLayout>
            <Text style={bodyText}>{buildBody(formattedDate)}</Text>
            <Text style={instructionText}>{INSTRUCTION}</Text>
            <Button style={ctaButton} href={signInUrl}>
                {CTA}
            </Button>
            <Text style={footer}>{FOOTER}</Text>
        </BaseLayout>
    );
}

const bodyText: React.CSSProperties = {
    color: EMAIL_COLORS.foreground,
    fontSize: '16px',
    marginBottom: '16px',
};

const instructionText: React.CSSProperties = {
    color: EMAIL_COLORS.foreground,
    fontSize: '16px',
    marginBottom: '32px',
};

const ctaButton: React.CSSProperties = {
    display: 'inline-block',
    backgroundColor: EMAIL_COLORS.primary,
    color: EMAIL_COLORS.primaryForeground,
    textDecoration: 'none',
    padding: '14px 32px',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 600,
};

const footer: React.CSSProperties = {
    color: EMAIL_COLORS.mutedForeground,
    fontSize: '13px',
    marginTop: '32px',
};
