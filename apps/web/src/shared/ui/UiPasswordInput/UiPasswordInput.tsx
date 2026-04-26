'use client';

import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import UiButton from '../UiButton';
import UiInput from '../UiInput';
import { composeClasses } from '@/shared/lib';
import type { UiPasswordInputProps } from './types';

const errorBorderStyles =
    'border-destructive hover:border-destructive focus-within:border-destructive';

const UiPasswordInput = forwardRef<HTMLInputElement, UiPasswordInputProps>(
    (props, ref) => {
        const {
            showLabel = 'Show password',
            hideLabel = 'Hide password',
            className,
            size = 'md',
            error,
            ...inputProps
        } = props;

        const [visible, setVisible] = useState(false);

        return (
            <div>
                <div className="relative">
                    <UiInput
                        {...inputProps}
                        ref={ref}
                        type={visible ? 'text' : 'password'}
                        size={size}
                        className={composeClasses(
                            'pr-12',
                            error && errorBorderStyles,
                            className
                        )}
                    />
                    <UiButton
                        variant="icon-compact"
                        size={size}
                        onClick={() => setVisible((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                        aria-label={visible ? hideLabel : showLabel}
                        IconLeft={visible ? <EyeOff /> : <Eye />}
                    />
                </div>
                {error && (
                    <p className="mt-1 text-sm text-destructive">{error}</p>
                )}
            </div>
        );
    }
);

UiPasswordInput.displayName = 'UiPasswordInput';

export default UiPasswordInput;
