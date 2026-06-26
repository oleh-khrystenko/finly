'use client';

import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import UiButton from '../UiButton';
import UiInput from '../UiInput';
import type { UiPasswordInputProps } from './types';

const UiPasswordInput = forwardRef<HTMLInputElement, UiPasswordInputProps>(
    (props, ref) => {
        const {
            showLabel = 'Show password',
            hideLabel = 'Hide password',
            size = 'md',
            ...inputProps
        } = props;

        const [visible, setVisible] = useState(false);

        return (
            <UiInput
                {...inputProps}
                ref={ref}
                type={visible ? 'text' : 'password'}
                size={size}
                IconRight={
                    <UiButton
                        variant="icon-compact"
                        size={size}
                        onClick={() => setVisible((v) => !v)}
                        aria-label={visible ? hideLabel : showLabel}
                        IconLeft={visible ? <EyeOff /> : <Eye />}
                    />
                }
            />
        );
    }
);

UiPasswordInput.displayName = 'UiPasswordInput';

export default UiPasswordInput;
