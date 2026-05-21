'use client';

import { forwardRef, useId } from 'react';
import { composeClasses } from '@/shared/lib';
import type { UiInputProps, UiInputSize, UiInputVariant } from './types';

const iconSizeStyles: Record<UiInputSize, string> = {
    sm: '[&>svg]:size-4',
    md: '[&>svg]:size-5',
    lg: '[&>svg]:size-6',
};

const sizeStyles: Record<UiInputSize, string> = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
};

const variantStyles: Record<UiInputVariant, string> = {
    outlined:
        'bg-transparent text-foreground border border-border hover:border-muted-foreground focus-within:border-primary',
    filled: 'bg-secondary text-foreground border border-transparent hover:bg-card focus-within:bg-card',
};

const errorStyles =
    'border-destructive hover:border-destructive focus-within:border-destructive';

const UiInput = forwardRef<HTMLInputElement, UiInputProps>((props, ref) => {
    const {
        variant = 'outlined',
        size = 'md',
        label,
        description,
        error,
        IconLeft,
        IconRight,
        className,
        disabled,
        required,
        id: externalId,
        ...inputProps
    } = props;

    const generatedId = useId();
    const inputId = externalId ?? generatedId;
    const errorId = `${inputId}-error`;
    const descriptionId = `${inputId}-description`;
    const describedBy = error ? errorId : description ? descriptionId : undefined;

    const iconClass = composeClasses(
        'shrink-0 text-muted-foreground',
        iconSizeStyles[size]
    );

    const wrapperClasses = composeClasses(
        'flex items-center gap-2',
        'rounded-md transition-colors',
        sizeStyles[size],
        variantStyles[variant],
        error && errorStyles,
        disabled && 'opacity-50 cursor-not-allowed',
        className
    );

    return (
        <div>
            {label && (
                <label
                    htmlFor={inputId}
                    className="text-foreground mb-1 block text-sm font-medium"
                >
                    {label}
                    {required && (
                        <span className="text-destructive ml-1">*</span>
                    )}
                </label>
            )}
            <div
                className={wrapperClasses}
                data-variant={variant}
                data-size={size}
            >
                {IconLeft && (
                    <span className={iconClass} aria-hidden>
                        {IconLeft}
                    </span>
                )}
                <input
                    {...inputProps}
                    id={inputId}
                    ref={ref}
                    disabled={disabled}
                    required={required}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy}
                    className="placeholder:text-muted-foreground w-full bg-transparent outline-none disabled:cursor-not-allowed"
                />
                {IconRight && (
                    <span className={iconClass} aria-hidden>
                        {IconRight}
                    </span>
                )}
            </div>
            {error ? (
                <p id={errorId} className="text-destructive mt-1 text-sm">
                    {error}
                </p>
            ) : (
                description && (
                    <p
                        id={descriptionId}
                        className="text-muted-foreground mt-1 text-xs"
                    >
                        {description}
                    </p>
                )
            )}
        </div>
    );
});

UiInput.displayName = 'UiInput';

export default UiInput;
