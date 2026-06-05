'use client';

import { forwardRef, Fragment } from 'react';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { composeClasses } from '@/shared/lib';
import type {
    UiDropdownMenuProps,
    UiDropdownMenuSize,
    UiDropdownMenuAlign,
} from './types';

const itemSizeStyles: Record<UiDropdownMenuSize, string> = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
};

const iconSizeStyles: Record<UiDropdownMenuSize, string> = {
    sm: '[&_svg]:size-4',
    md: '[&_svg]:size-5',
    lg: '[&_svg]:size-6',
};

const alignStyles: Record<UiDropdownMenuAlign, string> = {
    start: 'left-0',
    end: 'right-0',
};

const UiDropdownMenu = forwardRef<HTMLDivElement, UiDropdownMenuProps>(
    (props, ref) => {
        const {
            items,
            onSelect,
            activeValue,
            trigger,
            header,
            align = 'end',
            size = 'md',
            className,
        } = props;

        return (
            <Menu
                as="div"
                className="relative inline-flex items-center"
                ref={ref}
            >
                <MenuButton as={Fragment}>{trigger}</MenuButton>

                <MenuItems
                    className={composeClasses(
                        'absolute top-full z-50 mt-1 min-w-32',
                        'border-border bg-card rounded-lg border shadow-md',
                        'focus:outline-none',
                        alignStyles[align],
                        className
                    )}
                >
                    {header && (
                        <div className="border-border border-b px-3 py-2">
                            {header}
                        </div>
                    )}
                    <div className="space-y-0.5 p-1">
                        {items.map((item) => {
                            const isActive = activeValue === item.value;
                            return (
                                <MenuItem key={item.value}>
                                    <button
                                        type="button"
                                        onClick={() => onSelect(item.value)}
                                        className={composeClasses(
                                            'flex w-full items-center gap-2',
                                            'cursor-pointer rounded-md transition-colors',
                                            'data-[focus]:bg-accent',
                                            isActive && 'bg-accent',
                                            itemSizeStyles[size],
                                            iconSizeStyles[size]
                                        )}
                                    >
                                        {item.icon && (
                                            <span aria-hidden>{item.icon}</span>
                                        )}
                                        <span className="whitespace-nowrap">
                                            {item.label}
                                        </span>
                                        {item.badge != null && (
                                            <span className="bg-muted text-muted-foreground ml-auto rounded-full px-2.5 py-1 text-sm leading-none whitespace-nowrap">
                                                {item.badge}
                                            </span>
                                        )}
                                    </button>
                                </MenuItem>
                            );
                        })}
                    </div>
                </MenuItems>
            </Menu>
        );
    }
);

UiDropdownMenu.displayName = 'UiDropdownMenu';

export default UiDropdownMenu;
