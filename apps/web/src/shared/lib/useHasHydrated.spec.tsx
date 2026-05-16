import React from 'react';
import { render, act } from '@testing-library/react';

import { useHasHydrated } from './useHasHydrated';

interface MockPersist {
    persist: {
        hasHydrated: jest.MockedFunction<() => boolean>;
        onFinishHydration: jest.MockedFunction<(cb: () => void) => () => void>;
    };
}

function HydrationProbe(props: {
    store: MockPersist;
    onValue: (v: boolean) => void;
}) {
    const v = useHasHydrated(props.store);
    props.onValue(v);
    return null;
}

describe('useHasHydrated', () => {
    it('returns true одразу, якщо persist.hasHydrated() === true (snapshot)', () => {
        const store: MockPersist = {
            persist: {
                hasHydrated: jest.fn(() => true),
                onFinishHydration: jest.fn((_cb: () => void) => () => {}),
            },
        };
        const values: boolean[] = [];
        render(
            <HydrationProbe store={store} onValue={(v) => values.push(v)} />
        );

        expect(values[values.length - 1]).toBe(true);
    });

    it('returns false на mount + true після onFinishHydration callback (subscribe-flow)', () => {
        let hydrationCallback: (() => void) | null = null;
        const store: MockPersist = {
            persist: {
                hasHydrated: jest.fn(() => false),
                onFinishHydration: jest.fn((cb: () => void) => {
                    hydrationCallback = cb;
                    return () => {};
                }),
            },
        };
        const values: boolean[] = [];
        render(
            <HydrationProbe store={store} onValue={(v) => values.push(v)} />
        );

        expect(values[0]).toBe(false);
        expect(store.persist.onFinishHydration).toHaveBeenCalled();

        store.persist.hasHydrated.mockReturnValue(true);
        act(() => {
            hydrationCallback!();
        });

        expect(values[values.length - 1]).toBe(true);
    });

    it('викликає cleanup-функцію з onFinishHydration на unmount', () => {
        const cleanup = jest.fn();
        const store: MockPersist = {
            persist: {
                hasHydrated: jest.fn(() => false),
                onFinishHydration: jest.fn((_cb: () => void) => cleanup),
            },
        };

        const { unmount } = render(
            <HydrationProbe store={store} onValue={() => {}} />
        );

        unmount();

        expect(cleanup).toHaveBeenCalled();
    });

    it('SSR-defensive: store.persist undefined → returns false без crash', () => {
        const brokenStore = { persist: undefined } as unknown as MockPersist;

        const values: boolean[] = [];
        expect(() => {
            render(
                <HydrationProbe
                    store={brokenStore}
                    onValue={(v) => values.push(v)}
                />
            );
        }).not.toThrow();

        expect(values[values.length - 1]).toBe(false);
    });
});
