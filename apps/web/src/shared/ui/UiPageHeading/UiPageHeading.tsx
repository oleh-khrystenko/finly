import { composeClasses } from '@/shared/lib';
import type { UiPageHeadingProps } from './types';

const UiPageHeading = ({ children, className }: UiPageHeadingProps) => (
    <h1
        className={composeClasses(
            'text-foreground text-3xl font-bold tracking-tight',
            className
        )}
    >
        {children}
    </h1>
);

UiPageHeading.displayName = 'UiPageHeading';

export default UiPageHeading;
