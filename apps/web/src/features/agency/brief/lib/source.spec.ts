/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://cyanship.com/"}
 */

import { getSource, initSource } from './source';

const SESSION_KEY = 'brief_source';

function setUrl(path: string) {
    // history.pushState works in jsdom to change location.href
    window.history.pushState({}, '', path);
}

function mockReferrer(referrer: string) {
    Object.defineProperty(document, 'referrer', {
        value: referrer,
        configurable: true,
    });
}

describe('source tracking', () => {
    beforeEach(() => {
        sessionStorage.clear();
        setUrl('/');
        mockReferrer('');
    });

    describe('getSource', () => {
        it('detects utm_source parameter', () => {
            setUrl('/?utm_source=LinkedIn');

            expect(getSource()).toBe('linkedin');
        });

        it('detects external referrer hostname', () => {
            mockReferrer('https://www.linkedin.com/feed');

            expect(getSource()).toBe('linkedin.com');
        });

        it('returns direct when no UTM and no external referrer', () => {
            expect(getSource()).toBe('direct');
        });

        it('ignores same-origin referrer', () => {
            mockReferrer('https://cyanship.com/pricing');

            expect(getSource()).toBe('direct');
        });

        it('caches result in sessionStorage', () => {
            getSource();

            expect(sessionStorage.getItem(SESSION_KEY)).toBe('direct');
        });

        it('returns cached value on subsequent calls', () => {
            sessionStorage.setItem(SESSION_KEY, 'cached-source');

            expect(getSource()).toBe('cached-source');
        });
    });

    describe('initSource', () => {
        it('populates sessionStorage on call', () => {
            setUrl('/?utm_source=twitter');

            initSource();

            expect(sessionStorage.getItem(SESSION_KEY)).toBe('twitter');
        });
    });
});
