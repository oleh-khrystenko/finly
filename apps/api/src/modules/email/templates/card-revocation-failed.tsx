import { Text } from '@react-email/components';
import { EMAIL_COLORS } from '@finly/types';

import { BaseLayout } from './layouts/base';

export const CARD_REVOCATION_FAILED_SUBJECT =
    'Finly: картку не вдалося відкликати в monobank';

const ACTION =
    'Відкрийте гаманець у кабінеті monobank за ідентифікатором нижче і приберіть картку вручну.';
const FOOTER =
    'Самого токена картки лист не містить: це платіжний секрет. Система більше не повторюватиме спроби для цієї картки.';

interface CardRevocationFailedEmailProps {
    userId: string;
    /** Гаманець monobank платника; `null`, якщо його немає у профілі. */
    walletId: string | null;
    /** Скільки відмов банку поспіль було до відступу. */
    attempts: number;
}

export function CardRevocationFailedEmail({
    userId,
    walletId,
    attempts,
}: CardRevocationFailedEmailProps) {
    const what =
        'Банк раз за разом не приймав відкликання збереженої картки, тому ' +
        'система припинила спроби. Картка лишилась у гаманці monobank, у ' +
        'нашій базі її вже немає.';
    // Число окремим рядком, а не в реченні: узгодження з числівником ламалось
    // би на кожній зміні межі спроб (24 рази, 25 спроб, 21 спроба).
    const stats = `Невдалих спроб поспіль: ${attempts}.`;
    const who =
        `Платник: id ${userId}. Гаманець monobank: ${walletId ?? 'у профілі не вказано'}.`;

    return (
        <BaseLayout>
            <Text style={bodyText}>{what}</Text>
            <Text style={bodyText}>{stats}</Text>
            <Text style={bodyText}>{who}</Text>
            <Text style={bodyText}>{ACTION}</Text>
            <Text style={footer}>{FOOTER}</Text>
        </BaseLayout>
    );
}

const bodyText: React.CSSProperties = {
    color: EMAIL_COLORS.foreground,
    fontSize: '16px',
    marginBottom: '16px',
};

const footer: React.CSSProperties = {
    color: EMAIL_COLORS.mutedForeground,
    fontSize: '13px',
    marginTop: '32px',
};
