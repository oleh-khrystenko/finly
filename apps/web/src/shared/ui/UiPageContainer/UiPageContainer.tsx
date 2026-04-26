import { composeClasses } from '@/shared/lib';
import type { UiPageContainerProps } from './types';

const viewportHeight = 'h-[calc(100dvh-var(--header-height,64px))]';
const viewportMinHeight = 'min-h-[calc(100dvh-var(--header-height,64px))]';

const UiPageContainer = ({
    fixed = false,
    children,
    className,
}: UiPageContainerProps) => (
    <main
        className={composeClasses(
            'mx-auto flex w-full max-w-3xl flex-col px-4',
            fixed ? viewportHeight : viewportMinHeight,
            className,
        )}
    >
        {children}
    </main>
);

UiPageContainer.displayName = 'UiPageContainer';

export default UiPageContainer;
