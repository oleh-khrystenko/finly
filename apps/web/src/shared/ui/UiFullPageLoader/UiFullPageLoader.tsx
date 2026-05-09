import UiSpinner from '../UiSpinner';
import { composeClasses } from '@/shared/lib';
import type { UiFullPageLoaderProps } from './types';

const UiFullPageLoader = ({ message, className }: UiFullPageLoaderProps) => (
    <div
        className={composeClasses(
            'flex flex-1 flex-col items-center justify-center gap-4',
            className
        )}
    >
        <UiSpinner size="lg" />
        {message && <p className="text-muted-foreground text-lg">{message}</p>}
    </div>
);

UiFullPageLoader.displayName = 'UiFullPageLoader';

export default UiFullPageLoader;
