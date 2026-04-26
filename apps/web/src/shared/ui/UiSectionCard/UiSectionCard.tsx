import { composeClasses } from '@/shared/lib';
import type { UiSectionCardProps } from './types';

const borderStyles = {
    default: 'border-border',
    destructive: 'border-destructive/30',
} as const;

const UiSectionCard = ({
    title,
    headerRight,
    variant = 'default',
    className,
    children,
}: UiSectionCardProps) => (
    <section
        className={composeClasses(
            'rounded-xl border bg-card p-6 md:p-8',
            borderStyles[variant],
            className,
        )}
    >
        <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            {headerRight}
        </div>
        {children}
    </section>
);

UiSectionCard.displayName = 'UiSectionCard';

export default UiSectionCard;
