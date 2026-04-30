import { Button, Text } from '@react-email/components';
import { EMAIL_COLORS } from '@neatslip/types';

import { BaseLayout } from './layouts/base';

export const DELETION_CONFIRMATION_SUBJECT = 'Ваш акаунт NeatSlip деактивовано';

const CTA = 'Увійти';
const FOOTER =
    'Якщо ви не запитували видалення, негайно увійдіть у свій акаунт для його захисту.';

function buildBody(formattedDate: string): string {
    return `Ваш акаунт деактивовано за вашим запитом. Усі дані буде остаточно видалено ${formattedDate}.`;
}

function buildInstruction(graceDays: number): string {
    const dayWord =
        graceDays === 1
            ? 'день'
            : graceDays >= 2 && graceDays <= 4
              ? 'дні'
              : 'днів';
    return `Передумали? Просто увійдіть протягом ${graceDays} ${dayWord}, щоб відновити акаунт.`;
}

interface DeletionConfirmationEmailProps {
    signInUrl: string;
    formattedDate: string;
    graceDays: number;
}

export function DeletionConfirmationEmail({
    signInUrl,
    formattedDate,
    graceDays,
}: DeletionConfirmationEmailProps) {
    return (
        <BaseLayout>
            <Text style={bodyText}>{buildBody(formattedDate)}</Text>
            <Text style={instructionText}>{buildInstruction(graceDays)}</Text>
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
