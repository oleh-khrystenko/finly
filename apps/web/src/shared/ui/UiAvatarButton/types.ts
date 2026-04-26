import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import type { UiAvatarSize } from '../UiAvatar';

export interface UiAvatarButtonProps
    extends Omit<
        ComponentPropsWithoutRef<'button'>,
        'children' | 'aria-label'
    > {
    /**
     * Image source. When falsy or after a load error, the underlying avatar
     * renders `fallback` instead.
     */
    src?: string | null;
    /**
     * Content shown when there is no image to display (typically initials).
     * Required so the button always presents meaningful visual content.
     */
    fallback: ReactNode;
    size?: UiAvatarSize;
    /**
     * Optional node rendered above the avatar on hover / keyboard focus
     * (e.g. a camera icon for "edit photo"). Rendered inside the circular
     * clip region so it's clipped to the avatar's shape.
     */
    overlay?: ReactNode;
    /**
     * Required — the only accessible name for the button. Screen readers
     * announce the button through this label; the inner avatar is marked
     * decorative to avoid duplicate announcements.
     */
    'aria-label': string;
}
