import type { UiInputProps } from '../UiInput/types';

export interface UiPasswordInputProps extends Omit<
    UiInputProps,
    'type' | 'IconRight'
> {
    showLabel?: string;
    hideLabel?: string;
}
