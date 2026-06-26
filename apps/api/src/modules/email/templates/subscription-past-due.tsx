import { Button, Text } from '@react-email/components';
import { EMAIL_COLORS } from '@finly/types';

import { BaseLayout } from './layouts/base';

export const SUBSCRIPTION_PAST_DUE_SUBJECT =
    'Не вдалося продовжити підписку Finly';

const CTA = 'Оплатити зараз';
const FOOTER =
    'Якщо ви скасували картку або змінили її, просто оплатіть зараз: ми збережемо нову картку для наступних списань.';

interface SubscriptionPastDueEmailProps {
    planName: string;
    amountLabel: string;
    attempt: number;
    maxAttempts: number;
    billingUrl: string;
}

export function SubscriptionPastDueEmail({
    planName,
    amountLabel,
    attempt,
    maxAttempts,
    billingUrl,
}: SubscriptionPastDueEmailProps) {
    const body =
        `Ми не змогли списати оплату за «${planName}» (${amountLabel}). ` +
        `Доступ поки збережено. Спроба ${attempt} з ${maxAttempts}: ` +
        'ми повторимо списання найближчими днями.';

    return (
        <BaseLayout>
            <Text style={bodyText}>{body}</Text>
            <Text style={instructionText}>
                Щоб не втратити доступ, оплатіть підписку зараз.
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
