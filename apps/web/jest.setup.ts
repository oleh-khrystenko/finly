import '@testing-library/jest-dom';

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
