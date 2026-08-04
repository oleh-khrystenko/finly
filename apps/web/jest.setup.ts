import '@testing-library/jest-dom';

// Fail-fast env-loader (`shared/config/env.ts`) валиться на старті, якщо змінної
// немає, тож будь-який spec, що рендерить компонент з адресами хостів
// (публічна шапка, податкова сторінка, копіювання посилань), падав би до
// першого `expect`. Тестові плейсхолдери через `??=` — той самий виняток, що
// `apps/api/src/test-setup.ts` у політиці fail-fast: spec, якому значення
// важливе, мокає `@/shared/config` явно.
//
// Свідомо НЕ покриваємо цим усе підряд: `shared/lib/redirect` (єдиний модуль
// нижнього шару, що читає конфігурацію) навмисно поза barrel-ом `shared/lib`,
// інакше env став би обов'язковим для кожного UI-примітиву.
//
// Хости тут СВІДОМО прод-подібні (кабінет і pay на різних піддоменах), як і в
// `apps/api/src/test-setup.ts`. Dev розділяє їх портом — випадок, у якому
// піддомен ні на що не впливає; тести ж мусять покривати те, що працює у проді.
// Whitelist публічної зони (`shared/config/publicHosts.ts`) походить саме від
// `NEXT_PUBLIC_PAY_PUBLIC_URL`, тож з dev-значеннями `pay.finly.com.ua` перестав
// би вважатися публічним і host-isolation-перевірки лишились би формально
// зеленими. Сам dev-варіант (той самий host, різні порти) покритий у
// `shared/config/publicHosts.spec.ts`.
// У рантаймі ці імена проростає `next.config.ts` з `WEB_URL` / `PAY_PUBLIC_URL`
// (єдине джерело origin-ів, спільне з API). Jest next.config не виконує, тож
// підставляємо їх тут напряму.
process.env.NEXT_PUBLIC_BASE_URL ??= 'https://finly.com.ua';
process.env.NEXT_PUBLIC_PAY_PUBLIC_URL ??= 'https://pay.finly.com.ua';

// jsdom 26+ не вшиває `TextEncoder` у global; isomorphic utility у
// `@finly/types` (`utf8ByteLength` для NBU byte-limits) кидає
// `ReferenceError: TextEncoder is not defined` у будь-якому web spec, що
// тригерить `businessNameSchema` чи payload-builder через RHF resolver.
// Polyfill з node:util — той самий API, що у browsers і Node ≥18.
import { TextEncoder, TextDecoder } from 'util';
if (typeof globalThis.TextEncoder === 'undefined') {
    globalThis.TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
    globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
}

// jsdom не реалізує ResizeObserver; Headless UI 2.x Listbox/Combobox/Menu
// використовують його для positioning через @floating-ui — без stub
// fireEvent на ListboxOption кидає `ReferenceError: ResizeObserver is not
// defined`. Stub-noop достатній для тестів — реальний layout у jsdom не
// рахується, ми перевіряємо тільки event handlers + state transitions.
if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserverStub {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    };
}

// jsdom не реалізує scrollIntoView; focusFirstInvalidField (onInvalid-handler
// create-форм) викликає його у requestAnimationFrame — без stub невалідний
// submit кидав би async TypeError поза assert-ланцюгом тесту.
if (typeof Element.prototype.scrollIntoView === 'undefined') {
    Element.prototype.scrollIntoView = (): void => {};
}
