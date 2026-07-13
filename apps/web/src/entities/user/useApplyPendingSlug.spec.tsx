import { renderHook, waitFor } from '@testing-library/react';

const mockGetMe = jest.fn();
const mockRelease = jest.fn();
const mockSetUser = jest.fn();
const mockExtractCode = jest.fn();
let mockIsPaid = true;

jest.mock('@/shared/api', () => ({
    getMe: (...args: unknown[]) => mockGetMe(...args),
    releaseSlugReservation: (...args: unknown[]) => mockRelease(...args),
    extractApiErrorCode: (...args: unknown[]) => mockExtractCode(...args),
}));

// Хук торкається стору лише через `getState().setUser` (не як селектор-хук).
jest.mock('./authStore', () => ({
    useAuthStore: { getState: () => ({ setUser: mockSetUser }) },
}));

import { useApplyPendingSlug } from './useApplyPendingSlug';

describe('useApplyPendingSlug (Sprint 20)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockIsPaid = true;
        // За замовчуванням rename-fail трактуємо як «ім'я перехопили».
        mockExtractCode.mockReturnValue('SLUG_TAKEN');
    });

    it('платний з бронню: застосовує намір і освіжає стор, без onTaken/release', async () => {
        const apply = jest.fn().mockResolvedValue(undefined);
        const onTaken = jest.fn();
        mockGetMe.mockResolvedValue({ id: 'u1' });

        renderHook(() =>
            useApplyPendingSlug({
                matches: true,
                desiredSlug: 'new-name',
                isBranded: mockIsPaid,
                apply,
                onTaken,
            })
        );

        await waitFor(() => expect(apply).toHaveBeenCalledWith('new-name'));
        await waitFor(() =>
            expect(mockSetUser).toHaveBeenCalledWith({ id: 'u1' })
        );
        expect(onTaken).not.toHaveBeenCalled();
        expect(mockRelease).not.toHaveBeenCalled();
    });

    it('поач: apply падає → onTaken + знімає мертву бронь + освіжає стор', async () => {
        const apply = jest.fn().mockRejectedValue(new Error('SLUG_TAKEN'));
        const onTaken = jest.fn();
        mockRelease.mockResolvedValue(undefined);
        mockGetMe.mockResolvedValue({ id: 'u2' });

        renderHook(() =>
            useApplyPendingSlug({
                matches: true,
                desiredSlug: 'taken',
                isBranded: mockIsPaid,
                apply,
                onTaken,
            })
        );

        await waitFor(() => expect(onTaken).toHaveBeenCalled());
        await waitFor(() => expect(mockRelease).toHaveBeenCalled());
        await waitFor(() =>
            expect(mockSetUser).toHaveBeenCalledWith({ id: 'u2' })
        );
    });

    it('транзієнтний збій rename (не SLUG_TAKEN): бронь зберігається, без onTaken/release', async () => {
        const apply = jest.fn().mockRejectedValue(new Error('network'));
        const onTaken = jest.fn();
        mockExtractCode.mockReturnValue('unknown');

        renderHook(() =>
            useApplyPendingSlug({
                matches: true,
                desiredSlug: 'new-name',
                isBranded: mockIsPaid,
                apply,
                onTaken,
            })
        );

        await waitFor(() => expect(apply).toHaveBeenCalledWith('new-name'));
        // Холд ще валідний — не чіпаємо його, не показуємо «ім'я зайняте».
        expect(onTaken).not.toHaveBeenCalled();
        expect(mockRelease).not.toHaveBeenCalled();
        expect(mockSetUser).not.toHaveBeenCalled();
    });

    it('поач: release падає → onTaken все одно, стор не оновлюється, без краху', async () => {
        const apply = jest.fn().mockRejectedValue(new Error('SLUG_TAKEN'));
        const onTaken = jest.fn();
        mockRelease.mockRejectedValue(new Error('network'));

        renderHook(() =>
            useApplyPendingSlug({
                matches: true,
                desiredSlug: 'taken',
                isBranded: mockIsPaid,
                apply,
                onTaken,
            })
        );

        await waitFor(() => expect(mockRelease).toHaveBeenCalled());
        expect(onTaken).toHaveBeenCalled();
        // getMe стоїть ПІСЛЯ release у catch — якщо release кинув, до нього не дійшло.
        expect(mockGetMe).not.toHaveBeenCalled();
        expect(mockSetUser).not.toHaveBeenCalled();
    });

    it('неоплачений: намір не застосовується (гейт на рівні)', async () => {
        mockIsPaid = false;
        const apply = jest.fn();
        const onTaken = jest.fn();

        renderHook(() =>
            useApplyPendingSlug({
                matches: true,
                desiredSlug: 'x',
                isBranded: mockIsPaid,
                apply,
                onTaken,
            })
        );

        await Promise.resolve();
        expect(apply).not.toHaveBeenCalled();
        expect(onTaken).not.toHaveBeenCalled();
    });

    it('без збігу (matches=false): нічого не застосовує', async () => {
        const apply = jest.fn();
        const onTaken = jest.fn();

        renderHook(() =>
            useApplyPendingSlug({
                matches: false,
                desiredSlug: null,
                isBranded: mockIsPaid,
                apply,
                onTaken,
            })
        );

        await Promise.resolve();
        expect(apply).not.toHaveBeenCalled();
    });
});
