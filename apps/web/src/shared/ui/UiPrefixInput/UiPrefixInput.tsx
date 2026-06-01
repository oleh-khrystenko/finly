'use client';

import { forwardRef } from 'react';
import { composeClasses, OUTLINED_FIELD_STYLES } from '@/shared/lib';
import type { UiPrefixInputProps } from './types';

/**
 * Composite text-prefix + input у єдиній рамці (GitHub repo-URL / Vercel
 * project-slug / Linear workspace-URL стиль).
 *
 * `flex-wrap` дозволяє prefix зіскочити на окремий рядок над input на mobile-
 * 360 коли горизонталі бракує; `min-w-[8rem]` на input гарантує, що поле
 * лишається набираним і не сплющується до однієї літери.
 *
 * **Border/focus/error стилі** — спільний `OUTLINED_FIELD_STYLES` helper з
 * `shared/lib/`, той самий, що споживає `UiInput` outlined-variant. Single
 * source — оновлення border-токенів автоматично прокидається у обидва
 * компоненти без drift-у.
 */
const UiPrefixInput = forwardRef<HTMLInputElement, UiPrefixInputProps>(
    (props, ref) => {
        const { prefix, error, className, id, ...inputProps } = props;
        const errorId = id ? `${id}-error` : undefined;
        const wrapperClass = composeClasses(
            'flex flex-wrap items-stretch overflow-hidden',
            OUTLINED_FIELD_STYLES.shellBase,
            error
                ? OUTLINED_FIELD_STYLES.borderError
                : OUTLINED_FIELD_STYLES.borderIdle,
            className
        );
        return (
            <div>
                <div className={wrapperClass} data-state={error ? 'error' : undefined}>
                    <span
                        aria-hidden
                        className="bg-secondary text-muted-foreground flex shrink-0 items-center px-3 py-2 font-mono text-base select-none"
                    >
                        {prefix}
                    </span>
                    <input
                        {...inputProps}
                        ref={ref}
                        id={id}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errorId : undefined}
                        className="text-foreground placeholder:text-muted-foreground min-w-[8rem] flex-1 bg-transparent px-3 py-2 font-mono text-base outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    />
                </div>
                {error && (
                    <p id={errorId} className="text-destructive mt-1 text-sm">
                        {error}
                    </p>
                )}
            </div>
        );
    }
);

UiPrefixInput.displayName = 'UiPrefixInput';

export default UiPrefixInput;
