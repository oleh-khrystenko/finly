import { Text, Hr } from '@react-email/components';
import { EMAIL_COLORS } from '@cyanship/types';

import { BaseLayout } from './layouts/base';

interface BriefNotificationEmailProps {
    name: string;
    email: string;
    description: string;
    budget: string;
    budgetLabel: string;
    deadline: string | null;
    deadlineLabel: string | null;
    source: string | null;
}

export function BriefNotificationEmail({
    name,
    email,
    description,
    budgetLabel,
    deadlineLabel,
    source,
}: BriefNotificationEmailProps) {
    return (
        <BaseLayout lang="en">
            <Text style={heading}>New Brief Submission</Text>
            <Hr style={divider} />
            <Text style={field}>
                <strong>Name:</strong> {name}
            </Text>
            <Text style={field}>
                <strong>Email:</strong> {email}
            </Text>
            <Text style={field}>
                <strong>Budget:</strong> {budgetLabel}
            </Text>
            {deadlineLabel && (
                <Text style={field}>
                    <strong>Deadline:</strong> {deadlineLabel}
                </Text>
            )}
            {source && (
                <Text style={field}>
                    <strong>Source:</strong> {source}
                </Text>
            )}
            <Hr style={divider} />
            <Text style={descriptionLabel}>
                <strong>Description:</strong>
            </Text>
            <Text style={descriptionText}>{description}</Text>
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

const field: React.CSSProperties = {
    color: EMAIL_COLORS.foreground,
    fontSize: '14px',
    margin: '4px 0',
    textAlign: 'left' as const,
};

const descriptionLabel: React.CSSProperties = {
    ...field,
    marginBottom: '0',
};

const descriptionText: React.CSSProperties = {
    color: EMAIL_COLORS.foreground,
    fontSize: '14px',
    textAlign: 'left' as const,
    whiteSpace: 'pre-wrap' as const,
    marginTop: '4px',
};
