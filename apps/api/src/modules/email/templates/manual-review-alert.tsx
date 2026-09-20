import { Section, Text } from '@react-email/components';
import { EMAIL_COLORS } from '@finly/types';

import { BaseLayout } from './layouts/base';

export const MANUAL_REVIEW_ALERT_SUBJECT =
    'Finly: платіж потребує ручної перевірки';

const UNMATCHED_TITLE = 'Нерозпізнані списання (останні)';
const UNMATCHED_HINT =
    'Гроші пройшли, але не зараховані. Поверніть їх у кабінеті monobank за номером рахунку.';
const UNSETTLED_TITLE = 'Незавершені списання';
const UNSETTLED_HINT =
    'Результат списання невідомий. Звірте статус у кабінеті monobank.';
const EMPTY = 'Немає';
const FOOTER =
    'Лист надіслано автоматично. Новий прийде, якщо з’явиться ще один платіж для перевірки.';

/** Рядок списання, уже підготовлений до показу. */
export interface ManualReviewAlertRow {
    whenLabel: string;
    amountLabel: string;
    referenceLabel: string;
}

interface ManualReviewAlertEmailProps {
    userId: string;
    /** `null` — акаунт платника вже видалено. */
    userEmail: string | null;
    /** Чи стоїть прапорець перевірки в профілі на момент листа. */
    stillFlagged: boolean;
    unmatched: ManualReviewAlertRow[];
    unsettled: ManualReviewAlertRow[];
}

function ChargeList({
    title,
    hint,
    rows,
}: {
    title: string;
    hint: string;
    rows: ManualReviewAlertRow[];
}) {
    return (
        <Section style={section}>
            <Text style={sectionTitle}>{title}</Text>
            <Text style={hintText}>{hint}</Text>
            {rows.length === 0 ? (
                <Text style={rowText}>{EMPTY}</Text>
            ) : (
                rows.map((row) => (
                    <Text
                        key={`${row.whenLabel}-${row.referenceLabel}`}
                        style={rowText}
                    >
                        {`${row.whenLabel} — ${row.amountLabel} — ${row.referenceLabel}`}
                    </Text>
                ))
            )}
        </Section>
    );
}

export function ManualReviewAlertEmail({
    userId,
    userEmail,
    stillFlagged,
    unmatched,
    unsettled,
}: ManualReviewAlertEmailProps) {
    const payer = `Платник: ${userEmail ?? 'акаунт уже видалено'}, id ${userId}.`;
    const flag = stillFlagged
        ? 'Позначка перевірки в профілі платника стоїть.'
        : 'Позначку перевірки система вже зняла сама: результат списання з’ясувався. Перевірте, чи не лишилось зайвих грошей.';

    return (
        <BaseLayout>
            <Text style={bodyText}>{payer}</Text>
            <Text style={bodyText}>{flag}</Text>
            <ChargeList
                title={UNMATCHED_TITLE}
                hint={UNMATCHED_HINT}
                rows={unmatched}
            />
            <ChargeList
                title={UNSETTLED_TITLE}
                hint={UNSETTLED_HINT}
                rows={unsettled}
            />
            <Text style={footer}>{FOOTER}</Text>
        </BaseLayout>
    );
}

const bodyText: React.CSSProperties = {
    color: EMAIL_COLORS.foreground,
    fontSize: '16px',
    marginBottom: '16px',
};

const section: React.CSSProperties = {
    marginTop: '24px',
};

const sectionTitle: React.CSSProperties = {
    color: EMAIL_COLORS.foreground,
    fontSize: '16px',
    fontWeight: 600,
    margin: '0 0 4px',
};

const hintText: React.CSSProperties = {
    color: EMAIL_COLORS.mutedForeground,
    fontSize: '13px',
    margin: '0 0 12px',
};

const rowText: React.CSSProperties = {
    color: EMAIL_COLORS.foreground,
    fontSize: '14px',
    margin: '0 0 6px',
};

const footer: React.CSSProperties = {
    color: EMAIL_COLORS.mutedForeground,
    fontSize: '13px',
    marginTop: '32px',
};
