import { ChevronRight } from 'lucide-react';
import { composeClasses } from '@/shared/lib';
import UiLink from '@/shared/ui/UiLink';
import type { UiBreadcrumbProps } from './types';

/**
 * Контекстні хлібні крихти для вкладених cabinet-сторінок (Бізнес → Реквізити
 * → Рахунок). Предки — клікабельні `UiLink` вгору по дереву; останній сегмент
 * — поточна сторінка (`aria-current="page"`, не лінк). Кожен сегмент truncate-
 * иться, тож трейл не переповнює viewport на малих екранах.
 */
export default function UiBreadcrumb({ items, className }: UiBreadcrumbProps) {
    return (
        <nav
            aria-label="Навігація"
            className={composeClasses('min-w-0', className)}
        >
            <ol className="text-muted-foreground flex items-center gap-1.5 text-sm">
                {items.map((item, index) => {
                    const isCurrent = index === items.length - 1;
                    return (
                        <li
                            key={`${item.label}-${index}`}
                            className="flex min-w-0 items-center gap-1.5"
                        >
                            {index > 0 && (
                                <ChevronRight
                                    aria-hidden
                                    className="text-muted-foreground/50 size-4 shrink-0"
                                />
                            )}
                            {item.href && !isCurrent ? (
                                <UiLink
                                    as="link"
                                    href={item.href}
                                    variant="muted"
                                    // py-3/-my-3 — tap-зона 44px (responsive.md
                                    // #2) без росту візуальної висоти крихт.
                                    className="-my-3 block max-w-[9rem] truncate py-3 sm:max-w-[16rem]"
                                >
                                    {item.label}
                                </UiLink>
                            ) : (
                                <span
                                    aria-current={
                                        isCurrent ? 'page' : undefined
                                    }
                                    className="text-foreground truncate py-0.5 font-medium"
                                >
                                    {item.label}
                                </span>
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
