'use client';

import Link, { useLinkStatus } from 'next/link';
import { ReactNode, Ref, forwardRef } from 'react';
import { composeClasses } from '@/shared/lib';
import UiSpinner from '@/shared/ui/UiSpinner';
import type { UiSpinnerSize } from '@/shared/ui/UiSpinner';
import type {
    UiButtonCollapseBreakpoint,
    UiButtonProps,
    UiButtonSize,
    UiButtonVariant,
} from './types';

/**
 * CSS classes to control icon size via container.
 * Icons passed as ReactNode are sized by the wrapper, not by the caller.
 */
const iconSizeStyles_svg: Record<UiButtonSize, string> = {
    sm: '[&>svg]:size-4',
    md: '[&>svg]:size-5',
    lg: '[&>svg]:size-6',
};

const sizeStyles: Record<UiButtonSize, string> = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
};

/**
 * Size styles specifically for icon variant (square buttons)
 */
const iconSizeStyles: Record<UiButtonSize, string> = {
    sm: 'p-1.5',
    md: 'p-2',
    lg: 'p-3',
};

/**
 * Compact icon buttons without padding (size only affects icon scale)
 */
const iconCompactSizeStyles: Record<UiButtonSize, string> = {
    sm: 'p-0',
    md: 'p-0',
    lg: 'p-0',
};

/**
 * Inline-link sizes — без button-shaped padding (тільки font-size + height
 * via `min-h-11` для touch-target). Призначений для prose-style links у
 * footer, breadcrumbs, в'юверах юридичних сторінок тощо.
 */
const linkSizeStyles: Record<UiButtonSize, string> = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
};

/**
 * Theme-agnostic variant styles using neutral colors
 * Override via className prop for custom design systems
 */
const variantStyles: Record<UiButtonVariant, string> = {
    filled: 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80',
    outline:
        'border border-muted-foreground/40 bg-transparent text-muted-foreground hover:border-foreground hover:text-foreground active:bg-muted/50',
    soft: 'border border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
    'destructive-outline':
        'border border-destructive bg-transparent text-destructive hover:bg-destructive/10 active:bg-destructive/20',
    text: 'bg-transparent text-muted-foreground hover:text-foreground',
    'destructive-text':
        'bg-transparent text-destructive hover:text-destructive/80',
    icon: 'bg-transparent text-muted-foreground hover:text-foreground',
    'icon-compact':
        'bg-transparent text-muted-foreground hover:text-foreground',
    link: 'bg-transparent text-muted-foreground hover:text-foreground',
};

/**
 * Спінер-розмір для кожного button-size. md→sm не випадкове: 16px спінер у
 * 40px-кнопці виглядає пропорційно label-у; md-spinner (24px) переповнював би
 * вертикаль і змушував би layout-jump через стиснутий padding.
 */
const spinnerSizeForButton: Record<UiButtonSize, UiSpinnerSize> = {
    sm: 'sm',
    md: 'sm',
    lg: 'md',
};

// Статична мапа — Tailwind JIT не бачить динамічно склеєних класів.
const collapseLabelStyles: Record<UiButtonCollapseBreakpoint, string> = {
    '2xs': 'hidden 2xs:inline',
    sm: 'hidden sm:inline',
};

interface RenderContentProps {
    IconLeft?: ReactNode;
    IconRight?: ReactNode;
    children?: ReactNode;
    size: UiButtonSize;
    collapseLabel: boolean | UiButtonCollapseBreakpoint;
}

const renderContent = ({
    IconLeft,
    IconRight,
    children,
    size,
    collapseLabel,
}: RenderContentProps) => {
    const sizeClass = iconSizeStyles_svg[size];
    return (
        <>
            {IconLeft && (
                <span className={sizeClass} aria-hidden>
                    {IconLeft}
                </span>
            )}
            {children && (
                <span
                    className={
                        collapseLabel
                            ? collapseLabelStyles[
                                  collapseLabel === true ? 'sm' : collapseLabel
                              ]
                            : undefined
                    }
                >
                    {children}
                </span>
            )}
            {IconRight && (
                <span className={sizeClass} aria-hidden>
                    {IconRight}
                </span>
            )}
        </>
    );
};

interface WrapContentProps {
    content: ReactNode;
    loading: boolean;
    size: UiButtonSize;
    hasGap: boolean;
}

/**
 * При `loading` ховаємо реальний контент через `invisible` (зберігає bbox)
 * і кладемо спінер абсолютно по центру. Це той самий патерн, який раніше
 * робився руками у `auth/signin/page.tsx`, тепер інкапсульований у примітиві
 * — щоб усі кнопки з submit-state мали ідентичну поведінку без width-jump.
 */
const wrapContent = ({ content, loading, size, hasGap }: WrapContentProps) => {
    if (!loading) return content;
    return (
        <>
            <span
                className={composeClasses(
                    'inline-flex items-center',
                    hasGap && 'gap-2',
                    'invisible'
                )}
            >
                {content}
            </span>
            <span
                className="absolute inset-0 flex items-center justify-center"
                aria-hidden
            >
                <UiSpinner size={spinnerSizeForButton[size]} />
            </span>
        </>
    );
};

/**
 * Для `as="link"` додаємо безкоштовний pending-індикатор: під час client-side
 * навігації (`router.push`-еквівалент, що його робить `<Link>`) `useLinkStatus`
 * повертає `pending=true` поки наступна сторінка не зрендериться. Це знімає
 * потребу замінювати `<Link>` на `useTransition + router.push` лише заради
 * spinner-а — anchor-семантика (middle-click, контекстне меню, hover URL,
 * `role="link"`) зберігається. Викликається тільки усередині `<Link>`-нащадка,
 * де hook дійсно живе у відповідному контексті.
 */
const LinkLoadingWrapper = ({
    content,
    explicitLoading,
    size,
    hasGap,
}: {
    content: ReactNode;
    explicitLoading: boolean;
    size: UiButtonSize;
    hasGap: boolean;
}) => {
    const { pending } = useLinkStatus();
    return wrapContent({
        content,
        loading: explicitLoading || pending,
        size,
        hasGap,
    });
};

/**
 * Shared UI attributes for all button/link variants
 */
interface CommonProps {
    className: string;
    variant: UiButtonVariant;
    size: UiButtonSize;
    loading: boolean;
}

const getCommonProps = ({
    className,
    variant,
    size,
    loading,
}: CommonProps) => ({
    className,
    'data-variant': variant,
    'data-size': size,
    'aria-busy': loading || undefined,
});

/**
 * Additional props for link elements (internal and external)
 */
const getLinkAccessibilityProps = (blocked: boolean) => ({
    'aria-disabled': blocked,
    tabIndex: blocked ? -1 : undefined,
});

const UiButton = forwardRef<
    HTMLButtonElement | HTMLAnchorElement,
    UiButtonProps
>((props, ref) => {
    const {
        children,
        className,
        variant = 'filled',
        size = 'md',
        IconLeft,
        IconRight,
        disabled,
        loading = false,
        collapseLabel = false,
        linkPending = true,
    } = props;

    const blocked = disabled || loading;
    const hasGap = variant !== 'icon' && variant !== 'icon-compact';

    const classes = composeClasses(
        'inline-flex items-center justify-center rounded-lg relative',
        hasGap && 'gap-2',
        'cursor-pointer disabled:cursor-not-allowed',
        'focus:outline-none',
        'transition-colors',
        // `disabled` без `loading` — справжній disabled-state: greyed-out +
        // not-allowed cursor. `loading` навмисно НЕ грейкає кнопку, щоб
        // користувач бачив "запит у роботі", а не "кнопка вимкнена".
        disabled &&
            !loading &&
            'opacity-50 cursor-not-allowed pointer-events-none',
        loading && 'cursor-wait pointer-events-none',
        variant === 'icon'
            ? iconSizeStyles[size]
            : variant === 'icon-compact'
              ? iconCompactSizeStyles[size]
              : variant === 'link'
                ? linkSizeStyles[size]
                : sizeStyles[size],
        // Mobile touch-target baseline (44×44 px) для standalone icon-кнопок
        // та inline-link-ів. Required by docs/conventions/responsive.md §2;
        // інкапсулюємо у примітиві, щоб правило не залежало від ручного
        // className чи size="lg" у callers. icon-compact свідомо не покрито
        // — це dense desktop UI (toolbars, table-rows).
        (variant === 'icon' || variant === 'link') && 'min-h-11',
        variant === 'icon' && 'min-w-11',
        variantStyles[variant],
        className
    );

    const innerContent = renderContent({
        IconLeft,
        IconRight,
        children,
        size,
        collapseLabel,
    });
    const content = wrapContent({
        content: innerContent,
        loading,
        size,
        hasGap,
    });
    const commonProps = getCommonProps({
        className: classes,
        variant,
        size,
        loading,
    });
    const accessibilityProps = getLinkAccessibilityProps(blocked);

    // Type guard: Native anchor element
    if (props.as === 'a') {
        const {
            as: _as,
            href,
            variant: _variant,
            size: _size,
            className: _className,
            IconLeft: _iconLeft,
            IconRight: _iconRight,
            disabled: _disabled,
            loading: _loading,
            collapseLabel: _collapseLabel,
            linkPending: _linkPending,
            children: _children,
            ...anchorProps
        } = props;

        return (
            <a
                {...anchorProps}
                {...commonProps}
                {...accessibilityProps}
                href={href}
                onClick={(e) => {
                    if (blocked) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                    anchorProps.onClick?.(e);
                }}
                ref={ref as Ref<HTMLAnchorElement>}
            >
                {content}
            </a>
        );
    }

    // Type guard: Internal link
    if (props.as === 'link') {
        const {
            as: _as,
            href,
            variant: _variant,
            size: _size,
            className: _className,
            IconLeft: _iconLeft,
            IconRight: _iconRight,
            disabled: _disabled,
            loading: _loading,
            collapseLabel: _collapseLabel,
            linkPending: _linkPending,
            children: _children,
            ...linkProps
        } = props;

        return (
            <Link
                {...linkProps}
                {...commonProps}
                {...accessibilityProps}
                href={href}
                onClick={(e) => {
                    if (blocked) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                    linkProps.onClick?.(e);
                }}
                ref={ref as Ref<HTMLAnchorElement>}
            >
                {linkPending ? (
                    <LinkLoadingWrapper
                        content={innerContent}
                        explicitLoading={loading}
                        size={size}
                        hasGap={hasGap}
                    />
                ) : (
                    content
                )}
            </Link>
        );
    }

    // Default: Button
    const {
        as: _as,
        variant: _variant,
        size: _size,
        className: _className,
        IconLeft: _iconLeft,
        IconRight: _iconRight,
        disabled: _disabled,
        loading: _loading,
        collapseLabel: _collapseLabel,
        linkPending: _linkPending,
        children: _children,
        ...buttonProps
    } = props;

    return (
        <button
            {...buttonProps}
            {...commonProps}
            type={buttonProps.type ?? 'button'}
            disabled={blocked}
            onClick={(e) => {
                if (blocked) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                buttonProps.onClick?.(e);
            }}
            ref={ref as Ref<HTMLButtonElement>}
        >
            {content}
        </button>
    );
});

UiButton.displayName = 'UiButton';

export default UiButton;
