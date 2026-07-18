import { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { LinkProps } from 'next/link';

export type UiButtonVariant =
    | 'filled'
    | 'outline'
    | 'soft'
    | 'destructive-outline'
    | 'text'
    | 'destructive-text'
    | 'icon'
    | 'icon-compact'
    | 'link';
export type UiButtonSize = 'sm' | 'md' | 'lg';
export type UiButtonCollapseBreakpoint = '2xs' | 'sm';

/**
 * Base props shared by all button variants
 */
interface BaseProps {
    children?: ReactNode;
    variant?: UiButtonVariant;
    size?: UiButtonSize;
    className?: string;
    IconLeft?: ReactNode;
    IconRight?: ReactNode;
    disabled?: boolean;
    /**
     * Показує спінер по центру поверх контенту (children + icons лишаються
     * у DOM, але `invisible` — ширина кнопки не стрибає). Авто-блокує клік
     * (як `disabled`), але без `opacity-50`; cursor — `wait`. Розмір спінера
     * мапиться з `size`. Призначення — уніфікувати "submit-state" / "navigating"
     * на всьому сайті замість swap-у `children` руками у кожному callsite.
     */
    loading?: boolean;
    /**
     * Ховає текстовий лейбл на вузьких екранах, лишаючи тільки іконку — для
     * toolbar-кнопок, що на mobile стають icon-only. `true` еквівалентне `'sm'`
     * (`hidden sm:inline`); `'2xs'` ховає лейбл лише на найвужчих екранах
     * <390px (`hidden 2xs:inline`). Клас вішається на **власну** обгортку
     * лейбла, тож при collapse вона зникає з flex-потоку і `gap-2` не резервує
     * простір (інакше лишався б несиметричний відступ збоку від іконки).
     * Обов'язково парний з `aria-label` — коли текст візуально схований,
     * доступну назву несе саме він.
     */
    collapseLabel?: boolean | UiButtonCollapseBreakpoint;
    /**
     * Тільки для `as="link"`. За замовчуванням `true` — під час client-side
     * навігації показується спінер (`useLinkStatus.pending`) поверх контенту.
     * Для щільних рядків навігації (sidebar/drawer) це недоречно: спінер
     * загортає контент у додаткову обгортку і ламає layout рядка (стрибок
     * розміру). `false` вимикає авто-індикатор, лишаючи explicit `loading`.
     */
    linkPending?: boolean;
}

/**
 * Native button element
 */
export type ButtonProps = BaseProps &
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof BaseProps> & {
        as?: 'button';
        href?: never;
    };

/**
 * Internal link using Next.js Link component (client-side navigation)
 */
export type InternalLinkProps = BaseProps &
    Omit<LinkProps, keyof BaseProps | 'href'> & {
        as: 'link';
        href: LinkProps['href'];
    };

/**
 * Native anchor element — developer controls target/rel explicitly
 */
export type AnchorProps = BaseProps &
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof BaseProps> & {
        as: 'a';
        href: string;
    };

export type UiButtonProps = ButtonProps | InternalLinkProps | AnchorProps;
