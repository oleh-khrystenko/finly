import { Button, Text } from '@react-email/components';
import { EMAIL_COLORS } from '@finly/types';

import { BaseLayout } from './layouts/base';

export const SUBSCRIPTION_ENDED_SUBJECT = 'Підписку Finly призупинено';

const CTA = 'Оформити знову';
const FOOTER =
    'Ваші дані збережено. Щойно оформите підписку знову, доступ повернеться одразу.';

interface SubscriptionEndedEmailProps {
    planName: string;
    billingUrl: string;
}

export function SubscriptionEndedEmail({
    planName,
    billingUrl,
}: SubscriptionEndedEmailProps) {
    const body =
        `Кілька спроб списати оплату за «${planName}» не вдались, ` +
        'тож підписку призупинено і доступ до платних можливостей знято.';

    return (
        <BaseLayout>
            <Text style={bodyText}>{body}</Text>
            <Text style={instructionText}>
                Щоб відновити доступ, оформіть підписку знову.
            </Text>
            <Button style={ctaButton} href={billingUrl}>
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
