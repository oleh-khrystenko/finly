import { ArrowRight } from 'lucide-react';
import UiLink from '@/shared/ui/UiLink';
import { composeClasses } from '@/shared/lib';
import type { UiNavCardProps } from './types';

// Поверхня + її hover. `muted` лягає на `bg-card`-секцію контрастним тайлом,
// hover піднімає його ще на крок (`bg-accent`); `card` — елевейтед тайл на
// сторінковому `bg-background`.
const surfaceStyles: Record<NonNullable<UiNavCardProps['surface']>, string> = {
    card: 'bg-card group-hover:bg-muted/30',
    muted: 'bg-muted group-hover:bg-accent',
};

/**
 * Навігаційна картка-перехід: єдиний патерн для списків матрьошки
 * Отримувач → Реквізити → Рахунок. Уся картка — одне посилання, тобто рівно
 * одна дія: відкрити дочірню сторінку. Без вкладених кнопок (delete живе у
 * danger-zone сутності) і без вкладених посилань (nested-anchor = a11y-дефект).
 *
 * Слоти зверху-вниз: `eyebrow` (тихий лейбл) → рядок `title` (анкер) + `badge`
 * (статус/тег, на одній лінії праворуч) → `meta` (вторинні рядки) → footer
 * «Відкрити →». Стрілка зсувається на hover — афорданс єдиної дії. Focus-ring
 * приходить з `UiLink unstyled`, тож ціла картка — один keyboard tab-stop.
 */
const UiNavCard = ({
    href,
    title,
    titleAttr,
    ariaLabel,
    eyebrow,
    badge,
    meta,
    cta = 'Відкрити',
    surface = 'card',
}: UiNavCardProps) => {
    return (
        <UiLink
            as="link"
            href={href}
            variant="unstyled"
            aria-label={ariaLabel}
            className="group block h-full"
        >
            <article
                className={composeClasses(
                    'border-border group-hover:border-foreground/20 flex h-full flex-col gap-3 rounded-xl border p-5 transition-colors',
                    surfaceStyles[surface]
                )}
            >
                {eyebrow && (
                    <p className="text-muted-foreground truncate text-sm font-medium">
                        {eyebrow}
                    </p>
                )}

                <div className="flex items-center justify-between gap-2">
                    <p
                        className="text-foreground line-clamp-2 min-w-0 text-lg leading-snug font-semibold tracking-tight break-words"
                        title={titleAttr}
                    >
                        {title}
                    </p>
                    {badge}
                </div>

                {meta && (
                    <div className="text-muted-foreground space-y-2 text-sm break-words">
                        {meta}
                    </div>
                )}

                <div className="text-foreground mt-auto flex items-center gap-1.5 pt-2 text-sm font-medium">
                    <span>{cta}</span>
                    <ArrowRight
                        className="size-4 transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                    />
                </div>
            </article>
        </UiLink>
    );
};

UiNavCard.displayName = 'UiNavCard';

export default UiNavCard;
