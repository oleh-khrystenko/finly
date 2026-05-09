'use client';

import { Checkbox, Field, Label } from '@headlessui/react';
import { Check } from 'lucide-react';
import { composeClasses } from '@/shared/lib';
import type { UiCheckboxProps, UiCheckboxSize } from './types';

const boxSizeStyles: Record<UiCheckboxSize, string> = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
};

const iconSizeStyles: Record<UiCheckboxSize, number> = {
    sm: 12,
    md: 14,
    lg: 16,
};

const UiCheckbox = (props: UiCheckboxProps) => {
    const {
        checked,
        onChange,
        children,
        size = 'md',
        className,
        disabled = false,
        id,
        name,
        error,
    } = props;

    return (
        <Field disabled={disabled} className={className}>
            <div className="flex items-start gap-3">
                <Checkbox
                    checked={checked}
                    onChange={onChange}
                    id={id}
                    name={name}
                    className={composeClasses(
                        'flex shrink-0 cursor-pointer items-center justify-center rounded border-2 transition-colors duration-150',
                        'focus-visible:ring-ring mt-0.5 focus:outline-none focus-visible:ring-2',
                        disabled && 'cursor-not-allowed opacity-50',
                        checked
                            ? 'border-primary bg-primary'
                            : error
                              ? 'border-destructive'
                              : 'border-border',
                        boxSizeStyles[size]
                    )}
                >
                    {checked && (
                        <Check
                            size={iconSizeStyles[size]}
                            className="text-primary-foreground"
                            strokeWidth={3}
                        />
                    )}
                </Checkbox>
                {children && (
                    <Label className="text-muted-foreground cursor-pointer text-sm select-none">
                        {children}
                    </Label>
                )}
            </div>
            {error && (
                <p className="text-destructive mt-1 ml-8 text-sm">{error}</p>
            )}
        </Field>
    );
};

export default UiCheckbox;
