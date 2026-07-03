'use client';

import { forwardRef, useId } from 'react';
import {
    Listbox,
    ListboxButton,
    ListboxOption,
    ListboxOptions,
} from '@headlessui/react';
import { Check, ChevronDown } from 'lucide-react';
import { composeClasses, FIELD_LABEL_STYLES } from '@/shared/lib';
import type { UiSelectProps, UiSelectSize, UiSelectVariant } from './types';

const sizeStyles: Record<UiSelectSize, string> = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
};

const variantStyles: Record<UiSelectVariant, string> = {
    outlined:
        'bg-transparent text-foreground border border-border hover:border-muted-foreground focus-within:border-primary',
    filled: 'bg-secondary text-foreground border border-transparent hover:bg-card focus-within:bg-card',
};

const errorStyles =
    'border-destructive hover:border-destructive focus-within:border-destructive';

const optionSizeStyles: Record<UiSelectSize, string> = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
};

const UiSelect = forwardRef<HTMLButtonElement, UiSelectProps>((props, ref) => {
    const {
        options,
        value,
        onChange,
        variant = 'outlined',
        size = 'md',
        labelSize = 'sm',
        className,
        disabled = false,
        placeholder = 'Select an option',
        label,
        required,
        error,
    } = props;

    const generatedId = useId();
    const selected = options.find((o) => o.value === value);

    const buttonClasses = composeClasses(
        'flex w-full items-center justify-between gap-2',
        'rounded-md transition-colors',
        'cursor-pointer',
        'focus:outline-none',
        disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
        sizeStyles[size],
        variantStyles[variant],
        !!error && errorStyles,
        className
    );

    return (
        <Listbox value={value} onChange={onChange} disabled={disabled}>
            <div className="relative">
                {label && (
                    <label
                        id={generatedId}
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
                <ListboxButton
                    ref={ref}
                    aria-labelledby={label ? generatedId : undefined}
                    aria-invalid={error ? true : undefined}
                    className={buttonClasses}
                    data-variant={variant}
                    data-size={size}
                >
                    <span
                        className={composeClasses(
                            'truncate',
                            !selected && 'text-muted-foreground'
                        )}
                    >
                        {selected?.label || placeholder}
                    </span>
                    <ChevronDown className="text-muted-foreground ui-open:rotate-180 h-4 w-4 shrink-0 transition-transform" />
                </ListboxButton>

                <ListboxOptions
                    modal={false}
                    className={composeClasses(
                        'absolute z-50 mt-1 w-full',
                        'max-h-60 overflow-auto',
                        'border-border bg-card rounded-lg border shadow-md',
                        'focus:outline-none'
                    )}
                >
                    <div className="p-1">
                        {options.map((option) => (
                            <ListboxOption
                                key={option.value}
                                value={option.value}
                                className={composeClasses(
                                    'flex cursor-pointer items-center justify-between select-none',
                                    'text-foreground rounded-md transition-colors',
                                    'data-focus:bg-accent',
                                    optionSizeStyles[size]
                                )}
                            >
                                {({ selected: isSelected }) => (
                                    <>
                                        <span
                                            className={composeClasses(
                                                'truncate',
                                                isSelected && 'font-medium'
                                            )}
                                        >
                                            {option.label}
                                        </span>
                                        {isSelected && (
                                            <Check className="text-primary h-4 w-4 shrink-0" />
                                        )}
                                    </>
                                )}
                            </ListboxOption>
                        ))}
                    </div>
                </ListboxOptions>
                {error && (
                    <p className="text-destructive mt-1 text-sm">{error}</p>
                )}
            </div>
        </Listbox>
    );
});

UiSelect.displayName = 'UiSelect';

export default UiSelect;
