import { composeClasses } from '@/shared/lib';
import type { UiPageContainerProps } from './types';

// Sticky-footer flex-модель: сторінка росте, щоб заповнити простір МІЖ хедером
// і футером (`flex-1`), а не рахує висоту проти viewport. Стара калькуляція
// `100dvh − header` не знала про глобальний `AppFooter` → на коротких сторінках
// header + контент займали рівно viewport, а футер додавався понад нього й давав
// зайвий скрол. Висота футера ще й змінна (mobile vs desktop), тож calc був би
// крихким — flex-fill коректний за побудовою.
//
// Залежність: працює лише всередині flex-col-контейнера, обмеженого висотою
// viewport. Це гарантує root `<body class="flex min-h-dvh flex-col">` через
// обгортку `(protected)/layout.tsx` (`<div class="flex flex-1 flex-col">`).
const growHeight = 'flex-1';
// `fixed` — рівно доступна висота без розпирання контентом (`min-h-0` дозволяє
// flex-item стиснутись); внутрішній скрол — на відповідальності consumer-а.
const fixedHeight = 'min-h-0 flex-1';

const UiPageContainer = ({
    fixed = false,
    children,
    className,
}: UiPageContainerProps) => (
    <main
        className={composeClasses(
            'mx-auto flex w-full max-w-3xl flex-col px-4',
            fixed ? fixedHeight : growHeight,
            className
        )}
    >
        {children}
    </main>
);

UiPageContainer.displayName = 'UiPageContainer';

export default UiPageContainer;
