import { Hr, Text } from '@react-email/components';
import { EMAIL_COLORS } from '@cyanship/types';

import type { BriefConfirmationTranslations } from '../i18n/types';
import { BaseLayout } from './layouts/base';

interface BriefConfirmationEmailProps {
    name: string;
    translations: BriefConfirmationTranslations;
    lang: string;
}

export function BriefConfirmationEmail({
    name,
    translations: t,
    lang,
}: BriefConfirmationEmailProps) {
    return (
        <BaseLayout lang={lang}>
            <Text style={heading}>{t.heading}</Text>
            <Hr style={divider} />
            <Text style={bodyText}>{t.body(name)}</Text>
            <Text style={instructionText}>{t.instruction}</Text>
            <Text style={footer}>{t.footer}</Text>
        </BaseLayout>
    );
}

const heading: React.CSSProperties = {
    color: EMAIL_COLORS.foreground,
    fontSize: '20px',
    fontWeight: 700,
    marginBottom: '8px',
};

const divider: React.CSSProperties = {
    borderColor: EMAIL_COLORS.background,
    margin: '16px 0',
};

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

const footer: React.CSSProperties = {
    color: EMAIL_COLORS.mutedForeground,
    fontSize: '13px',
    marginTop: '32px',
};
