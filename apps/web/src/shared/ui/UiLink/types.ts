import { AnchorHTMLAttributes, ReactNode } from 'react';
import { LinkProps } from 'next/link';

export type UiLinkVariant =
    | 'primary'
    | 'primary-underline'
    | 'muted'
    | 'subtle'
    | 'unstyled';

interface BaseProps {
    children?: ReactNode;
    variant?: UiLinkVariant;
    className?: string;
}

/**
 * Native anchor element (default)
 */
export type AnchorLinkProps = BaseProps &
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof BaseProps> & {
        as?: 'a';
        href: string;
    };

/**
 * Internal link using Next.js Link component (client-side navigation)
 */
export type InternalLinkProps = BaseProps &
    Omit<LinkProps, keyof BaseProps | 'href'> & {
        as: 'link';
        href: LinkProps['href'];
    };

export type UiLinkProps = AnchorLinkProps | InternalLinkProps;
