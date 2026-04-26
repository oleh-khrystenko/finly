'use client';

import { Switch } from '@headlessui/react';
import { composeClasses } from '@/shared/lib';
import type { UiSwitchProps, UiSwitchSize } from './types';

/**
 * Container sizes for the switch track
 */
const containerSizeStyles: Record<UiSwitchSize, string> = {
    sm: 'h-5 w-10',
    md: 'h-6 w-12',
    lg: 'h-7 w-14',
};

/**
 * Toggle button sizes and positions
 */
const toggleSizeStyles: Record<UiSwitchSize, string> = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
};

/**
 * Toggle translate positions when checked
 */
const toggleTranslateStyles: Record<UiSwitchSize, string> = {
    sm: 'translate-x-5',
    md: 'translate-x-6',
    lg: 'translate-x-7',
};

/**
 * Theme-agnostic switch component using neutral colors
 * Override via className prop for custom design systems
 */
const UiSwitch = (props: UiSwitchProps) => {
    const {
        checked,
        onChange,
        children,
        size = 'md',
        className,
        disabled = false,
        id,
        name,
    } = props;

    const containerClasses = composeClasses(
        'relative inline-flex items-center justify-between rounded-full',
        'cursor-pointer disabled:cursor-not-allowed',
        'focus:outline-none',
        'transition-colors duration-200',
        'px-px',
        checked ? 'bg-primary' : 'bg-border',
        disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
        containerSizeStyles[size],
        className
    );

    const toggleClasses = composeClasses(
        'absolute rounded-full bg-white z-10',
        'transition-transform duration-200',
        checked ? toggleTranslateStyles[size] : 'translate-x-0.5',
        toggleSizeStyles[size]
    );

    return (
        <Switch
            checked={checked}
            onChange={onChange}
            disabled={disabled}
            id={id}
            name={name}
            className={containerClasses}
        >
            <span className={toggleClasses} />
            {children}
        </Switch>
    );
};

export default UiSwitch;
