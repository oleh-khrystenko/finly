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
    id,
    children,
}: UiSectionCardProps) => (
    <section
        id={id}
        className={composeClasses(
            'bg-card rounded-xl border p-6 md:p-8',
            borderStyles[variant],
            className
        )}
    >
        <div className="flex items-center justify-between">
            <h2 className="text-foreground text-2xl font-semibold tracking-tight">
                {title}
            </h2>
            {headerRight}
        </div>
        {children}
    </section>
);

UiSectionCard.displayName = 'UiSectionCard';

export default UiSectionCard;
