import { Button, Text } from '@react-email/components';
import {
    EMAIL_COLORS,
    MAGIC_LINK_PURPOSE,
    type MagicLinkPurpose,
} from '@neatslip/types';

import { BaseLayout } from './layouts/base';

interface MagicLinkCopy {
    subject: string;
    body: string;
    cta: string;
    footer: string;
}

const COPY: Record<MagicLinkPurpose, MagicLinkCopy> = {
    [MAGIC_LINK_PURPOSE.LOGIN]: {
        subject: 'Посилання для входу в NeatSlip',
        body: 'Ми отримали запит на вхід у ваш акаунт. Натисніть кнопку нижче, щоб продовжити.',
        cta: 'Увійти',
        footer: 'Посилання дійсне 15 хвилин. Якщо ви не запитували вхід, просто ігноруйте цей лист.',
    },
    [MAGIC_LINK_PURPOSE.REGISTER]: {
        subject: 'Ласкаво просимо до NeatSlip',
        body: 'Дякуємо за реєстрацію. Натисніть кнопку нижче, щоб завершити створення акаунту.',
        cta: 'Завершити реєстрацію',
        footer: 'Посилання дійсне 15 хвилин. Якщо ви не створювали акаунт, просто ігноруйте цей лист.',
    },
    [MAGIC_LINK_PURPOSE.RESET_PASSWORD]: {
        subject: 'Скидання пароля NeatSlip',
        body: 'Ми отримали запит на скидання пароля для вашого акаунту. Натисніть кнопку нижче, щоб встановити новий пароль.',
        cta: 'Скинути пароль',
        footer: 'Посилання дійсне 15 хвилин. Якщо ви не запитували скидання, ваш пароль залишається незмінним — жодних дій не потрібно.',
    },
    [MAGIC_LINK_PURPOSE.DELETE_ACCOUNT]: {
        subject: 'Підтвердження видалення акаунту',
        body: 'Ми отримали запит на видалення вашого акаунту NeatSlip. Натисніть кнопку нижче, щоб підтвердити.',
        cta: 'Підтвердити видалення',
        footer: 'Посилання дійсне 15 хвилин. Якщо ви не запитували видалення, просто ігноруйте цей лист — ваш акаунт залишиться без змін.',
    },
};

export function getMagicLinkSubject(purpose: MagicLinkPurpose): string {
    return COPY[purpose].subject;
}

interface MagicLinkEmailProps {
    purpose: MagicLinkPurpose;
    link: string;
}

export function MagicLinkEmail({ purpose, link }: MagicLinkEmailProps) {
    const t = COPY[purpose];
    return (
        <BaseLayout>
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
