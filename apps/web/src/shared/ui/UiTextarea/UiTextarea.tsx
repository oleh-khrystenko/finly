'use client';

import { forwardRef, useCallback, useId, useRef, useEffect } from 'react';
import { composeClasses } from '@/shared/lib';
import type {
    UiTextareaProps,
    UiTextareaSize,
    UiTextareaVariant,
} from './types';

const sizeStyles: Record<UiTextareaSize, string> = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
};

const variantStyles: Record<UiTextareaVariant, string> = {
    outlined:
        'bg-transparent text-foreground border border-border hover:border-muted-foreground focus-within:border-primary',
    filled: 'bg-secondary text-foreground border border-transparent hover:bg-card focus-within:bg-card',
};

const errorStyles =
    'border-destructive hover:border-destructive focus-within:border-destructive';

const DEFAULT_MAX_ROWS = 6;

const UiTextarea = forwardRef<HTMLTextAreaElement, UiTextareaProps>(
    (props, ref) => {
        const {
            variant = 'outlined',
            size = 'md',
            label,
            error,
            suffix,
            autoGrow = false,
            maxRows = DEFAULT_MAX_ROWS,
            className,
            disabled,
            required,
            id: externalId,
            onChange,
            value,
            ...textareaProps
        } = props;

        const generatedId = useId();
        const textareaId = externalId ?? generatedId;
        const internalRef = useRef<HTMLTextAreaElement | null>(null);

        const adjustHeight = useCallback(() => {
            const el = internalRef.current;
            if (!el || !autoGrow) return;

            el.style.height = 'auto';
            const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
            const maxHeight = lineHeight * maxRows;
            el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
            el.style.overflowY =
                el.scrollHeight > maxHeight ? 'auto' : 'hidden';
        }, [autoGrow, maxRows]);

        useEffect(() => {
            adjustHeight();
        }, [value, adjustHeight]);

        const setRefs = useCallback(
            (el: HTMLTextAreaElement | null) => {
                internalRef.current = el;
                if (typeof ref === 'function') ref(el);
                else if (ref) ref.current = el;
            },
            [ref],
        );

        const handleChange = useCallback(
            (e: React.ChangeEvent<HTMLTextAreaElement>) => {
                onChange?.(e);
            },
            [onChange],
        );

        const wrapperClasses = composeClasses(
            'rounded-md transition-colors',
            sizeStyles[size],
            variantStyles[variant],
            error && errorStyles,
            disabled && 'opacity-50 cursor-not-allowed',
            className,
        );

        const noResize = autoGrow || !!suffix;

        return (
            <div>
                {label && (
                    <label
                        htmlFor={textareaId}
                        className="mb-1 block text-sm font-medium text-foreground"
                    >
                        {label}
                        {required && (
                            <span className="ml-1 text-destructive">*</span>
                        )}
                    </label>
                )}
                <div
                    className={wrapperClasses}
                    data-variant={variant}
                    data-size={size}
                >
                    <textarea
                        {...textareaProps}
                        id={textareaId}
                        ref={setRefs}
                        value={value}
                        onChange={handleChange}
                        disabled={disabled}
                        required={required}
                        className={`w-full bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed ${noResize ? 'resize-none' : 'resize-y'}`}
                    />
                    {suffix}
                </div>
                {error && (
                    <p className="mt-1 text-sm text-destructive">{error}</p>
                )}
            </div>
        );
    },
);

UiTextarea.displayName = 'UiTextarea';

export default UiTextarea;
