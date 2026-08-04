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
            // `@container` — секції живуть і в широкому стовпі, і у вузькій
            // бічній колонці двоколонкового кабінету; внутрішні розкладки
            // (UiUpsellNote, BrandSection) реагують на ширину картки через
            // `@sm:`/`@md:`, а не на viewport.
            'bg-card @container rounded-xl border p-4 md:p-6',
            borderStyles[variant],
            className
        )}
    >
        <div className="flex items-center justify-between">
            <h2 className="text-foreground text-lg font-semibold tracking-tight">
                {title}
            </h2>
            {headerRight}
        </div>
        {children}
    </section>
);

UiSectionCard.displayName = 'UiSectionCard';

export default UiSectionCard;
