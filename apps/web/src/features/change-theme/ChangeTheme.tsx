'use client';

import { useSyncExternalStore, type FC, type ReactNode } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon, SunMoon } from 'lucide-react';
import { THEME, Theme } from '@/shared/types/settings';
import UiButton from '@/shared/ui/UiButton';
import UiDropdownMenu from '@/shared/ui/UiDropdownMenu';
import type { UiDropdownMenuItem } from '@/shared/ui/UiDropdownMenu';

export const THEME_ICONS: Record<Theme, typeof Sun> = {
    [THEME.LIGHT]: Sun,
    [THEME.SYSTEM]: SunMoon,
    [THEME.DARK]: Moon,
};

export const THEME_LABELS: Record<Theme, string> = {
    [THEME.LIGHT]: 'Світла',
    [THEME.SYSTEM]: 'Системна',
    [THEME.DARK]: 'Темна',
};

const THEME_VALUES: Theme[] = [THEME.LIGHT, THEME.SYSTEM, THEME.DARK];

interface ChangeThemeProps {
    trigger?: ReactNode;
    align?: 'start' | 'end';
}

const subscribe = () => () => {};

const useIsHydrated = () =>
    useSyncExternalStore(
        subscribe,
        () => true,
        () => false
    );

const getActiveTheme = (
    theme: string | undefined,
    isHydrated: boolean
): Theme => {
    if (!isHydrated) {
        return THEME.SYSTEM;
    }

    return Object.values(THEME).includes(theme as Theme)
        ? (theme as Theme)
        : THEME.SYSTEM;
};

const ChangeTheme: FC<ChangeThemeProps> = ({
    trigger: customTrigger,
    align = 'end',
}) => {
    const { theme, setTheme } = useTheme();
    const isHydrated = useIsHydrated();

    const activeTheme = getActiveTheme(theme, isHydrated);
    const TriggerIcon = THEME_ICONS[activeTheme];

    const items: UiDropdownMenuItem[] = THEME_VALUES.map((value) => {
        const Icon = THEME_ICONS[value];
        return {
            value,
            label: THEME_LABELS[value],
            icon: <Icon />,
        };
    });

    const defaultTrigger = (
        <UiButton
            variant="icon"
            size="sm"
            aria-label="Змінити тему"
            className="size-9"
            IconLeft={<TriggerIcon />}
        />
    );

    return (
        <UiDropdownMenu
            items={items}
            onSelect={setTheme}
            activeValue={activeTheme}
            align={align}
            size="sm"
            trigger={customTrigger ?? defaultTrigger}
        />
    );
};

export default ChangeTheme;
