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
