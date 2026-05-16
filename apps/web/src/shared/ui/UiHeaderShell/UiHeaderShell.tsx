import { composeClasses } from '@/shared/lib';
import type { UiHeaderShellProps } from './types';

const UiHeaderShell = ({ children, className }: UiHeaderShellProps) => (
    <header
        className={composeClasses(
            'container flex h-16 items-center justify-between px-6',
            className
        )}
    >
        {children}
    </header>
);

UiHeaderShell.displayName = 'UiHeaderShell';

export default UiHeaderShell;
