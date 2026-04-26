import { LoaderCircle } from 'lucide-react';
import { composeClasses } from '@/shared/lib';
import type { UiSpinnerProps, UiSpinnerSize } from './types';

const sizeMap: Record<UiSpinnerSize, number> = {
    sm: 16,
    md: 24,
    lg: 40,
};

const UiSpinner = ({ size = 'md', className }: UiSpinnerProps) => {
    return (
        <LoaderCircle
            width={sizeMap[size]}
            height={sizeMap[size]}
            className={composeClasses('animate-spin text-current', className)}
            aria-hidden="true"
        />
    );
};

UiSpinner.displayName = 'UiSpinner';

export default UiSpinner;
