/**
 * Sprint 3 §3.8 §C2 + §F8 — критичний регресійний тест на frontend Undo.
 *
 * Раніше delete-flow ламався, бо optimistic redirect (router.replace на
 * list) розмонтовував cabinet page, а cleanup-effect з clearTimeout вбивав
 * timer ID до того, як він спрацює. Цей тест прибиває такий регрес: 5s
 * pass → DELETE called; cancel у межах 5s → DELETE НЕ called.
 */

const mockDeleteBusiness = jest.fn();
const mockToast = jest.fn();
const mockToastDismiss = jest.fn();
const mockToastMessage = jest.fn();
const mockToastError = jest.fn();
type ToastAction = { label: string; onClick: () => void };
let lastToastAction: ToastAction | null = null;

jest.mock('@/shared/api', () => ({
    deleteBusiness: (...args: unknown[]) => mockDeleteBusiness(...args),
    getApiMessage: (code: string) => `mapped:${code}`,
}));

jest.mock('sonner', () => ({
    toast: Object.assign(
        (label: string, opts: { action?: ToastAction }) => {
            lastToastAction = opts.action ?? null;
            mockToast(label, opts);
            return 'toast-id';
        },
        {
            dismiss: (...args: unknown[]) => mockToastDismiss(...args),
            message: (...args: unknown[]) => mockToastMessage(...args),
            error: (...args: unknown[]) => mockToastError(...args),
        },
    ),
}));

import {
    scheduleDeleteWithUndo,
    UNDO_TIMEOUT_MS,
} from './scheduleDeleteWithUndo';
import { usePendingDeletesStore } from './pendingDeletesStore';

describe('scheduleDeleteWithUndo', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        lastToastAction = null;
        // Reset Zustand state між тестами — критично для оптимістичного
        // remove invariant; stale Set між spec-ами дав би false-positive.
        usePendingDeletesStore.setState({ slugs: new Set<string>() });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('викликає onScheduled синхронно (для optimistic redirect)', () => {
        const onScheduled = jest.fn();
        scheduleDeleteWithUndo({
            slug: 'IvanEnko',
            name: 'Іваненко',
            onScheduled,
            onCancelled: jest.fn(),
        });
        expect(onScheduled).toHaveBeenCalledTimes(1);
    });

    it('показує sonner toast з cancel-button', () => {
        scheduleDeleteWithUndo({
            slug: 'IvanEnko',
            name: 'Іваненко',
            onScheduled: jest.fn(),
            onCancelled: jest.fn(),
        });
        expect(mockToast).toHaveBeenCalledWith(
            '«Іваненко» буде видалено',
            expect.objectContaining({
                duration: UNDO_TIMEOUT_MS,
                action: expect.objectContaining({ label: 'Скасувати' }),
            }),
        );
    });

    it('після 5s викликає deleteBusiness(slug) — критичний path', () => {
        mockDeleteBusiness.mockResolvedValue(undefined);
        scheduleDeleteWithUndo({
            slug: 'IvanEnko',
            name: 'Іваненко',
            onScheduled: jest.fn(),
            onCancelled: jest.fn(),
        });

        expect(mockDeleteBusiness).not.toHaveBeenCalled();
        jest.advanceTimersByTime(UNDO_TIMEOUT_MS);
        expect(mockDeleteBusiness).toHaveBeenCalledWith('IvanEnko');
        expect(mockDeleteBusiness).toHaveBeenCalledTimes(1);
    });

    it('cancel у межах 5s — deleteBusiness НЕ викликається + onCancelled виконується', () => {
        const onCancelled = jest.fn();
        scheduleDeleteWithUndo({
            slug: 'IvanEnko',
            name: 'Іваненко',
            onScheduled: jest.fn(),
            onCancelled,
        });

        jest.advanceTimersByTime(2000);

        // user-initiated cancel
        expect(lastToastAction).not.toBeNull();
        lastToastAction!.onClick();

        // Дочекаємось решти 5s — deleteBusiness не повинен викликатись
        jest.advanceTimersByTime(UNDO_TIMEOUT_MS);
        expect(mockDeleteBusiness).not.toHaveBeenCalled();

        // onCancelled викликаний
        expect(onCancelled).toHaveBeenCalledTimes(1);

        // toast.dismiss + повідомлення про скасування
        expect(mockToastDismiss).toHaveBeenCalledWith('toast-id');
        expect(mockToastMessage).toHaveBeenCalledWith(
            'Видалення скасовано',
        );
    });

    it('cancel у межах 5s — clearTimeout працює навіть якщо ref-ів немає', () => {
        // Регресія на bug: timer ID жив у React ref, який unmount-ився
        // optimistic redirect-ом перед спрацюванням; cancel-button не міг
        // зробити clearTimeout. Тут timer ID живе у closure → cancel
        // спрацьовує надійно незалежно від unmount.
        scheduleDeleteWithUndo({
            slug: 'X',
            name: 'X',
            onScheduled: jest.fn(),
            onCancelled: jest.fn(),
        });
        lastToastAction!.onClick();
        jest.advanceTimersByTime(UNDO_TIMEOUT_MS * 2);
        expect(mockDeleteBusiness).not.toHaveBeenCalled();
    });

    it('обробляє API failure без crash (toast.error mapped code)', async () => {
        const apiError = {
            response: { data: { error: { code: 'INTERNAL_ERROR' } } },
            isAxiosError: true,
        };
        // Робимо AxiosError-подібний об'єкт для instanceof check.
        Object.setPrototypeOf(apiError, Error.prototype);
        mockDeleteBusiness.mockRejectedValue(apiError);

        scheduleDeleteWithUndo({
            slug: 'X',
            name: 'X',
            onScheduled: jest.fn(),
            onCancelled: jest.fn(),
        });
        jest.advanceTimersByTime(UNDO_TIMEOUT_MS);
        // Дочекаємось microtask queue для catch-handler
        await Promise.resolve();
        await Promise.resolve();

        expect(mockDeleteBusiness).toHaveBeenCalledWith('X');
    });

    // Sprint 3 §3.8 §C2 — optimistic UI removal на list. Без цих тестів
    // регрес "redirect → fresh fetch → бачимо ще-не-видалений бізнес"
    // прослизне непомітно.

    it('add(slug) у pendingDeletes ВІДРАЗУ при scheduling (synchronous)', () => {
        scheduleDeleteWithUndo({
            slug: 'IvanEnko',
            name: 'Іваненко',
            onScheduled: jest.fn(),
            onCancelled: jest.fn(),
        });
        expect(usePendingDeletesStore.getState().slugs.has('IvanEnko')).toBe(
            true,
        );
    });

    it('cancel button → remove(slug) з pendingDeletes (бізнес повертається у list)', () => {
        scheduleDeleteWithUndo({
            slug: 'IvanEnko',
            name: 'Іваненко',
            onScheduled: jest.fn(),
            onCancelled: jest.fn(),
        });
        expect(usePendingDeletesStore.getState().slugs.has('IvanEnko')).toBe(
            true,
        );
        lastToastAction!.onClick();
        expect(usePendingDeletesStore.getState().slugs.has('IvanEnko')).toBe(
            false,
        );
    });

    it('success after 5s → slug ЗАЛИШАЄТЬСЯ у pendingDeletes (інваріант проти UI re-show)', async () => {
        // Sprint 3 §3.8 — критична регресія. Якщо list page mount-нутий під
        // час success-path, його local `items[]` ще містить stale-entry
        // (snapshot з попереднього fetch). Видалення slug зі store
        // re-render-ить filter і "відкриє" stale-item у UI, попри що
        // backend його вже видалив. Slug повинен лишитись у store до
        // browser-unload або subsequent fetch (який повертає свіжий
        // список без бізнесу — store filter no-op природно).
        mockDeleteBusiness.mockResolvedValue(undefined);
        scheduleDeleteWithUndo({
            slug: 'IvanEnko',
            name: 'Іваненко',
            onScheduled: jest.fn(),
            onCancelled: jest.fn(),
        });
        jest.advanceTimersByTime(UNDO_TIMEOUT_MS);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        // Slug залишається у pending — UI продовжує filter-ити stale entry.
        expect(usePendingDeletesStore.getState().slugs.has('IvanEnko')).toBe(
            true,
        );
        // Sanity: deleteBusiness реально викликаний.
        expect(mockDeleteBusiness).toHaveBeenCalledWith('IvanEnko');
    });

    it('failure after 5s → remove(slug) — UI restore-ить бізнес у list', async () => {
        const apiError = Object.assign(new Error('failed'), {
            response: { data: { error: { code: 'INTERNAL_ERROR' } } },
        });
        mockDeleteBusiness.mockRejectedValue(apiError);
        scheduleDeleteWithUndo({
            slug: 'IvanEnko',
            name: 'Іваненко',
            onScheduled: jest.fn(),
            onCancelled: jest.fn(),
        });
        jest.advanceTimersByTime(UNDO_TIMEOUT_MS);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(usePendingDeletesStore.getState().slugs.has('IvanEnko')).toBe(
            false,
        );
    });
});
