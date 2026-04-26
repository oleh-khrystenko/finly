import { ReactNode } from 'react';

export type UiSwitchSize = 'sm' | 'md' | 'lg';

/**
 * Base props for UiSwitch component
 */
export interface UiSwitchProps {
    checked: boolean;
    onChange?: (checked: boolean) => void;
    children?: ReactNode;
    size?: UiSwitchSize;
    className?: string;
    disabled?: boolean;
    id?: string;
    name?: string;
}
