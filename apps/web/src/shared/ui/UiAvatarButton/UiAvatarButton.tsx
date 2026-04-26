'use client';

import { forwardRef } from 'react';

import { composeClasses } from '@/shared/lib';

import { UiAvatar } from '../UiAvatar';
import type { UiAvatarButtonProps } from './types';

/**
 * Clickable circular avatar primitive.
 *
 * UiButton (variant="icon") is deliberately not used: its `renderContent`
 * wraps children in an inline `<span>`, its hardcoded icon padding would
 * distort the avatar, and its default `rounded-lg` conflicts with the
 * circular clip we need for the hover overlay. A dedicated primitive keeps
 * the contract narrow and the styling direct.
 *
 * Accessibility model:
 *   - The native `<button>` is the only interactive element and owns the
 *     accessible name via the required `aria-label` prop.
 *   - The inner `UiAvatar` (which itself carries `role="img"`) sits inside
 *     an `aria-hidden` wrapper so screen readers announce the button exactly
 *     once, without duplicating through the avatar's role.
 *   - The overlay is purely visual and inherits the `aria-hidden` wrapper.
 */
const UiAvatarButton = forwardRef<HTMLButtonElement, UiAvatarButtonProps>(
    (
        {
            src,
            fallback,
            size = 'xl',
            overlay,
            className,
            disabled,
            type,
            ...rest
        },
        ref
    ) => {
        return (
            <button
                {...rest}
                ref={ref}
                type={type ?? 'button'}
                disabled={disabled}
                data-slot="avatar-button"
                className={composeClasses(
                    'group relative inline-flex shrink-0 items-center justify-center rounded-full',
                    'cursor-pointer transition-opacity',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    className
                )}
            >
                <span aria-hidden="true" className="contents">
                    <UiAvatar src={src} alt="" fallback={fallback} size={size} />
                    {overlay && (
                        <span
                            data-slot="avatar-button-overlay"
                            className={composeClasses(
                                'pointer-events-none absolute inset-0 flex items-center justify-center',
                                'rounded-full bg-foreground/45 text-primary-foreground',
                                'opacity-0 transition-opacity',
                                'group-hover:opacity-100 group-focus-visible:opacity-100'
                            )}
                        >
                            {overlay}
                        </span>
                    )}
                </span>
            </button>
        );
    }
);

UiAvatarButton.displayName = 'UiAvatarButton';

export { UiAvatarButton };
