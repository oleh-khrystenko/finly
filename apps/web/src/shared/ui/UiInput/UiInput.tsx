'use client';

import { forwardRef, useId } from 'react';
import {
    composeClasses,
    FIELD_LABEL_STYLES,
    OUTLINED_FIELD_STYLES,
} from '@/shared/lib';
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
    outlined: composeClasses(
        'bg-transparent text-foreground',
        OUTLINED_FIELD_STYLES.borderIdle
    ),
    filled: 'bg-secondary text-foreground border-transparent hover:bg-card focus-within:bg-card',
};

const errorStyles = OUTLINED_FIELD_STYLES.borderError;

const UiInput = forwardRef<HTMLInputElement, UiInputProps>((props, ref) => {
    const {
        variant = 'outlined',
        size = 'md',
        labelSize = 'sm',
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
        'shrink-0 text-muted-foreground flex items-center justify-center',
        iconSizeStyles[size]
    );

    const wrapperClasses = composeClasses(
        'flex items-center gap-2',
        OUTLINED_FIELD_STYLES.shellBase,
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
                    className={composeClasses(
                        'text-foreground',
                        FIELD_LABEL_STYLES[labelSize]
                    )}
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
                {IconRight && <span className={iconClass}>{IconRight}</span>}
            </div>
            {error ? (
                <p id={errorId} className="text-destructive mt-1 text-sm">
                    {error}
                </p>
            ) : (
                description && (
                    <p
                        id={descriptionId}
                        className="text-muted-foreground mt-1 text-sm"
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
