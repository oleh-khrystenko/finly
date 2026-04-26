import { Button, Text } from '@react-email/components';
import { EMAIL_COLORS } from '@cyanship/types';

import type { MagicLinkTranslations } from '../i18n/types';
import { BaseLayout } from './layouts/base';

interface MagicLinkEmailProps {
    link: string;
    translations: MagicLinkTranslations;
    lang: string;
}

export function MagicLinkEmail({
    link,
    translations: t,
    lang,
}: MagicLinkEmailProps) {
    return (
        <BaseLayout lang={lang}>
            <Text style={bodyText}>{t.body}</Text>
            <Button style={ctaButton} href={link}>
                {t.cta}
            </Button>
            <Text style={footer}>{t.footer}</Text>
        </BaseLayout>
    );
}

const bodyText: React.CSSProperties = {
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
