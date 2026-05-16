import { Button, Text } from '@react-email/components';
import { EMAIL_COLORS } from '@finly/types';

import { BaseLayout } from './layouts/base';
import { EMAIL_TEXT } from '../translations';

interface ProfileCompletionFinalWarningEmailProps {
    businesses: Array<{ name: string }>;
    ctaHref: string;
}

export function ProfileCompletionFinalWarningEmail({
    businesses,
    ctaHref,
}: ProfileCompletionFinalWarningEmailProps) {
    const copy = EMAIL_TEXT.profileCompletion.finalWarning;
    const body =
        businesses.length === 1
            ? copy.singleBody(businesses[0].name)
            : copy.multiBody(businesses.map((b) => b.name));

    return (
        <BaseLayout>
            <Text style={bodyText}>{body}</Text>
            <Button style={ctaButton} href={ctaHref}>
                {copy.cta}
            </Button>
        </BaseLayout>
    );
}

const bodyText: React.CSSProperties = {
    color: EMAIL_COLORS.foreground,
    fontSize: '16px',
    marginBottom: '32px',
    textAlign: 'left',
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
