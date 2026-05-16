import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export type UiAvatarSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl';

export interface UiAvatarProps extends Omit<
    ComponentPropsWithoutRef<'span'>,
    'children' | 'role' | 'aria-label'
> {
    /**
     * Image source. When falsy or after a load error, the avatar
     * displays `fallback` instead. Accepts `null`/`undefined` so callers
     * can pass optional fields directly without nullish coalescing.
     */
    src?: string | null;
    /**
     * Accessible label for the avatar. Required because the avatar is a
     * meaningful UI atom (`role="img"`) — passing an empty string is a
     * deliberate "decorative" choice and must be explicit at the call
     * site, never a silent default.
     */
    alt: string;
    /**
     * Visual content shown when there is no image or it fails to load
     * (typically initials). Required so the avatar always renders
     * something meaningful, never an empty disc.
     */
    fallback: ReactNode;
    size?: UiAvatarSize;
    /**
     * Forwarded to `next/image`. Use for above-the-fold avatars (e.g.
     * the header) so the loader prioritizes them.
     */
    priority?: boolean;
}
