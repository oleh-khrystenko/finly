import { Button, Text } from '@react-email/components';
import { EMAIL_COLORS } from '@finly/types';

import { BaseLayout } from './layouts/base';

export const CARD_CHANGED_SUBJECT = 'Платіжну картку Finly змінено';

const CTA = 'Відкрити тарифи';
const FOOTER =
    'Якщо картку міняли не ви, зверніться до нас якнайшвидше: хтось міг отримати доступ до вашого кабінету.';

interface CardChangedEmailProps {
    /** Маска нової картки; `null`, якщо банк її не повернув. */
    cardMask: string | null;
    billingUrl: string;
}

export function CardChangedEmail({
    cardMask,
    billingUrl,
}: CardChangedEmailProps) {
    const body = cardMask
        ? `Платіжну картку для підписки Finly змінено на ${cardMask}. Наступні списання підуть з неї.`
        : 'Платіжну картку для підписки Finly змінено. Наступні списання підуть з нової картки.';

    return (
        <BaseLayout>
            <Text style={bodyText}>{body}</Text>
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
