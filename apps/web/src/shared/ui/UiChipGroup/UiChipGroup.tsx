'use client';

import { useId } from 'react';
import { Radio, RadioGroup } from '@headlessui/react';
import { composeClasses } from '@/shared/lib';
import type { UiChipGroupProps, UiChipGroupSize } from './types';

const chipSizeStyles: Record<UiChipGroupSize, string> = {
    sm: 'px-3 py-1 text-sm',
    md: 'px-4 py-1.5 text-base',
    lg: 'px-5 py-2 text-lg',
};

const UiChipGroup = (props: UiChipGroupProps) => {
    const {
        options,
        value,
        onChange,
        size = 'md',
        className,
        disabled = false,
        label,
        required,
        error,
    } = props;

    const generatedId = useId();

    return (
        <div className={className}>
            {label && (
                <label
                    id={generatedId}
                    className="text-foreground mb-1 block text-sm font-medium"
                >
                    {label}
                    {required && (
                        <span className="text-destructive ml-1">*</span>
                    )}
                </label>
            )}
            <RadioGroup
                value={value}
                onChange={onChange}
                disabled={disabled}
                aria-labelledby={label ? generatedId : undefined}
                className="flex flex-wrap gap-2"
            >
                {options.map((option) => (
                    <Radio
                        key={option.value}
                        value={option.value}
                        className={composeClasses(
                            'cursor-pointer rounded-md border transition-colors select-none',
                            'border-border text-muted-foreground hover:border-muted-foreground',
                            'focus-visible:ring-ring focus:outline-none focus-visible:ring-2',
                            'data-checked:border-primary data-checked:bg-primary/10 data-checked:text-primary data-checked:hover:border-primary',
                            disabled && 'cursor-not-allowed opacity-50',
                            chipSizeStyles[size]
                        )}
                    >
                        {option.label}
                    </Radio>
                ))}
            </RadioGroup>
            {error && <p className="text-destructive mt-1 text-sm">{error}</p>}
        </div>
    );
};

export default UiChipGroup;
