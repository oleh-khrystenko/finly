import { Button, Text } from '@react-email/components';
import { EMAIL_COLORS } from '@neatslip/types';

import { BaseLayout } from './layouts/base';

interface DeletionConfirmationEmailProps {
    signInUrl: string;
    translations: {
        body: (formattedDate: string) => string;
        instruction: string;
        cta: string;
        footer: string;
    };
    formattedDate: string;
    lang: string;
}

export function DeletionConfirmationEmail({
    signInUrl,
    translations: t,
    formattedDate,
    lang,
}: DeletionConfirmationEmailProps) {
    return (
        <BaseLayout lang={lang}>
            <Text style={bodyText}>{t.body(formattedDate)}</Text>
            <Text style={instructionText}>{t.instruction}</Text>
            <Button style={ctaButton} href={signInUrl}>
                {t.cta}
            </Button>
            <Text style={footer}>{t.footer}</Text>
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
