import Link from 'next/link';
import { forwardRef } from 'react';
import { composeClasses } from '@/shared/lib';
import type { UiLinkProps, UiLinkVariant } from './types';

const variantStyles: Record<UiLinkVariant, string> = {
    primary: 'text-primary hover:underline',
    'primary-underline': 'text-primary underline hover:no-underline',
    muted: 'text-muted-foreground hover:text-foreground',
    subtle: 'underline decoration-muted-foreground/30 underline-offset-4 hover:text-muted-foreground',
    // Wrapper-only: no text styling, для card-links де візуал несе вкладений
    // контейнер. Лишає focus-ring з baseStyles.
    unstyled: '',
};

const baseStyles =
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm';

const UiLink = forwardRef<HTMLAnchorElement, UiLinkProps>((props, ref) => {
    const { children, className, variant = 'primary' } = props;

    const classes = composeClasses(
        baseStyles,
        variantStyles[variant],
        className
    );

    if (props.as === 'link') {
        const {
            as: _as,
            href,
            variant: _variant,
            className: _className,
            children: _children,
            ...linkProps
        } = props;

        return (
            <Link {...linkProps} href={href} className={classes} ref={ref}>
                {children}
            </Link>
        );
    }

    const {
        as: _as,
        href,
        variant: _variant,
        className: _className,
        children: _children,
        ...anchorProps
    } = props;

    return (
        <a {...anchorProps} href={href} className={classes} ref={ref}>
            {children}
        </a>
    );
});

UiLink.displayName = 'UiLink';

export default UiLink;
