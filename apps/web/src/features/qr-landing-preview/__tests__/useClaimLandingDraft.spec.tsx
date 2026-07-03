import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { AxiosError } from 'axios';

jest.mock('@/shared/config', () => ({
    ENV: {
        NEXT_PUBLIC_API_URL: 'http://localhost:4000/api',
        NEXT_PUBLIC_BASE_URL: 'http://localhost:3000',
        NEXT_PUBLIC_PAY_PUBLIC_URL: 'http://localhost:3001',
    },
}));

const mockCreateBusiness = jest.fn();
const mockCreateAccount = jest.fn();
const mockRouterReplace = jest.fn();
const mockToastInfo = jest.fn();
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();

jest.mock('../api', () => ({
    createBusinessFromDraft: (...args: unknown[]) =>
        mockCreateBusiness(...args),
    createAccountFromDraft: (...args: unknown[]) => mockCreateAccount(...args),
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: mockRouterReplace, push: jest.fn() }),
}));

jest.mock('sonner', () => ({
    toast: {
        info: (...args: unknown[]) => mockToastInfo(...args),
        success: (...args: unknown[]) => mockToastSuccess(...args),
        error: (...args: unknown[]) => mockToastError(...args),
    },
}));

const mockListBusinesses = jest.fn();
const mockListAccounts = jest.fn();

jest.mock('@/shared/api/businesses', () => ({
    listBusinesses: (...args: unknown[]) => mockListBusinesses(...args),
}));

jest.mock('@/shared/api/accounts', () => ({
    listAccounts: (...args: unknown[]) => mockListAccounts(...args),
}));

import { useClaimLandingDraft } from '../useClaimLandingDraft';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';
import { useAuthStore } from '@/entities/user';

function HookHarness() {
    useClaimLandingDraft();
    return null;
}

const VALID_FORM = {
    receiverName: 'Іваненко',
    iban: 'UA213223130000026007233566001',
    taxId: '1234567899',
    purpose: 'Поповнення рахунку',
};

const UUID = '00000000-0000-4000-8000-000000000000';

const seedClaimPending = (): void => {
    useQrLandingDraftStore.getState().setFormData(VALID_FORM);
    useQrLandingDraftStore.getState().setIntent('claim-pending');
};

const setAnon = (): void => {
    useAuthStore.getState().clearUser();
};

const setAuthedComplete = (): void => {
    useAuthStore.getState().setUser({
        id: 'u1',
        email: 'user@test.com',
        profile: {
            firstName: 'Іван',
            lastName: 'Іваненко',
            acceptedTermsVersion: 1,
        },
    } as never);
};

const setAuthedIncomplete = (): void => {
    useAuthStore.getState().setUser({
        id: 'u1',
        email: 'user@test.com',
        profile: {
            firstName: '',
            lastName: '',
            acceptedTermsVersion: 1,
        },
    } as never);
};

describe('useClaimLandingDraft — pre-conditions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useQrLandingDraftStore.getState().clearAll();
        useAuthStore.getState().clearUser();
        localStorage.clear();
    });

    it('anon → POST1 не fires', () => {
        setAnon();
        seedClaimPending();

        render(<HookHarness />);

        expect(mockCreateBusiness).not.toHaveBeenCalled();
    });

    it('authed + onboarding incomplete + claim-pending → POST1 не fires (чекає на profile)', () => {
        setAuthedIncomplete();
        seedClaimPending();

        render(<HookHarness />);

        expect(mockCreateBusiness).not.toHaveBeenCalled();
    });

    it('authed + complete + intent=idle → POST1 не fires (нема explicit запиту)', () => {
        setAuthedComplete();
        useQrLandingDraftStore.getState().setFormData(VALID_FORM);

        render(<HookHarness />);

        expect(mockCreateBusiness).not.toHaveBeenCalled();
    });

    it('authed + complete + claim-pending + valid form → POST1 з draft + idempotencyKey', async () => {
        mockCreateBusiness.mockResolvedValue({ slug: 'iva-X3kQ' });
        mockCreateAccount.mockResolvedValue({ slug: 'acc-aB12cD34' });
        setAuthedComplete();
        seedClaimPending();
        const key = useQrLandingDraftStore.getState().claimIdempotencyKey!;
        expect(key).not.toBeNull();

        render(<HookHarness />);

        await waitFor(() => {
            expect(mockCreateBusiness).toHaveBeenCalledWith(VALID_FORM, key);
        });
    });
});

describe('useClaimLandingDraft — success path (POST1 + POST2)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useQrLandingDraftStore.getState().clearAll();
        useAuthStore.getState().clearUser();
        localStorage.clear();
    });

    it('обидва POST успішні → clearAll + toast + redirect на per-account', async () => {
        mockCreateBusiness.mockResolvedValue({ slug: 'iva-X3kQ' });
        mockCreateAccount.mockResolvedValue({ slug: 'acc-aB12cD34' });
        setAuthedComplete();
        seedClaimPending();

        render(<HookHarness />);

        await waitFor(() => {
            expect(mockCreateAccount).toHaveBeenCalledWith(
                'iva-X3kQ',
                VALID_FORM
            );
            expect(mockToastSuccess).toHaveBeenCalledWith(
                'Отримувача і реквізити збережено'
            );
            expect(mockRouterReplace).toHaveBeenCalledWith(
                '/business/iva-X3kQ/account/acc-aB12cD34'
            );
            const s = useQrLandingDraftStore.getState();
            expect(s.formData).toEqual({});
            expect(s.intent).toBe('idle');
            expect(s.claimIdempotencyKey).toBeNull();
        });
    });
});

describe('useClaimLandingDraft — failure paths', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useQrLandingDraftStore.getState().clearAll();
        useAuthStore.getState().clearUser();
        localStorage.clear();
    });

    it('POST1 (Business) fail → intent=claim-failed-business, formData збережено, redirect на /business/new?from=landing', async () => {
        mockCreateBusiness.mockRejectedValue(new Error('500 Internal'));
        setAuthedComplete();
        seedClaimPending();

        render(<HookHarness />);

        await waitFor(() => {
            expect(mockToastError).toHaveBeenCalled();
            expect(mockRouterReplace).toHaveBeenCalledWith(
                '/business/new?from=landing'
            );
            const s = useQrLandingDraftStore.getState();
            expect(s.intent).toBe('claim-failed-business');
            expect(s.formData).toEqual(VALID_FORM);
            expect(mockCreateAccount).not.toHaveBeenCalled();
        });
    });

    it('POST2 (Account) fail → intent=claim-failed-account, formData збережено, redirect на /business/{slug}/account/new?from=landing', async () => {
        mockCreateBusiness.mockResolvedValue({ slug: 'iva-X3kQ' });
        mockCreateAccount.mockRejectedValue(new Error('409 IBAN duplicate'));
        setAuthedComplete();
        seedClaimPending();

        render(<HookHarness />);

        await waitFor(() => {
            expect(mockToastError).toHaveBeenCalled();
            expect(mockRouterReplace).toHaveBeenCalledWith(
                '/business/iva-X3kQ/account/new?from=landing'
            );
            const s = useQrLandingDraftStore.getState();
            expect(s.intent).toBe('claim-failed-account');
            expect(s.formData).toEqual(VALID_FORM);
        });
    });

    it('schema-drift у localStorage: невалідний formData → claim-failed-business без API', () => {
        setAuthedComplete();
        useQrLandingDraftStore.getState().setFormData({
            receiverName: '',
            iban: 'invalid',
            taxId: '123',
            purpose: 'x',
        });
        useQrLandingDraftStore.getState().setIntent('claim-pending');

        render(<HookHarness />);

        expect(mockCreateBusiness).not.toHaveBeenCalled();
        expect(mockToastError).toHaveBeenCalled();
        expect(useQrLandingDraftStore.getState().intent).toBe(
            'claim-failed-business'
        );
    });
});

describe('useClaimLandingDraft — type-limit merge у наявну фізособу', () => {
    const typeLimitError = () => {
        const err = new AxiosError('Forbidden');
        err.response = {
            data: { error: { code: 'BUSINESS_TYPE_LIMIT_REACHED' } },
        } as never;
        return err;
    };

    const EXISTING_INDIVIDUAL = {
        slug: 'iva-X3kQ',
        type: 'individual',
        name: 'Іваненко Іван',
        taxId: VALID_FORM.taxId,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        useQrLandingDraftStore.getState().clearAll();
        useAuthStore.getState().clearUser();
        localStorage.clear();
    });

    it('РНОКПП збігається, IBAN новий → toast.info + redirect на account/new?from=landing', async () => {
        mockCreateBusiness.mockRejectedValue(typeLimitError());
        mockListBusinesses.mockResolvedValue([EXISTING_INDIVIDUAL]);
        mockListAccounts.mockResolvedValue([
            { slug: 'acc-old', iban: 'UA903052992990004149123456789' },
        ]);
        setAuthedComplete();
        seedClaimPending();

        render(<HookHarness />);

        await waitFor(() => {
            expect(mockToastInfo).toHaveBeenCalledWith(
                'У вас вже є отримувач «Іваненко Іван». Додайте ці реквізити до нього'
            );
            expect(mockRouterReplace).toHaveBeenCalledWith(
                '/business/iva-X3kQ/account/new?from=landing'
            );
            const s = useQrLandingDraftStore.getState();
            expect(s.intent).toBe('claim-failed-account');
            expect(s.formData).toEqual(VALID_FORM);
            expect(mockToastError).not.toHaveBeenCalled();
        });
    });

    it('РНОКПП збігається, IBAN уже збережений → «вже збережено» + redirect на реквізити + clearAll', async () => {
        mockCreateBusiness.mockRejectedValue(typeLimitError());
        mockListBusinesses.mockResolvedValue([EXISTING_INDIVIDUAL]);
        mockListAccounts.mockResolvedValue([
            { slug: 'acc-same', iban: VALID_FORM.iban },
        ]);
        setAuthedComplete();
        seedClaimPending();

        render(<HookHarness />);

        await waitFor(() => {
            expect(mockToastSuccess).toHaveBeenCalledWith(
                'Ці реквізити вже збережені у кабінеті'
            );
            expect(mockRouterReplace).toHaveBeenCalledWith(
                '/business/iva-X3kQ/account/acc-same'
            );
            const s = useQrLandingDraftStore.getState();
            expect(s.intent).toBe('idle');
            expect(s.formData).toEqual({});
        });
    });

    it('РНОКПП інший (QR для іншої людини) → generic failure-path без merge', async () => {
        mockCreateBusiness.mockRejectedValue(typeLimitError());
        mockListBusinesses.mockResolvedValue([
            { ...EXISTING_INDIVIDUAL, taxId: '9876543215' },
        ]);
        setAuthedComplete();
        seedClaimPending();

        render(<HookHarness />);

        await waitFor(() => {
            expect(mockToastError).toHaveBeenCalled();
            expect(mockRouterReplace).toHaveBeenCalledWith(
                '/business/new?from=landing'
            );
            expect(useQrLandingDraftStore.getState().intent).toBe(
                'claim-failed-business'
            );
            expect(mockListAccounts).not.toHaveBeenCalled();
        });
    });

    it('збій фонового fetch-у списку → deliberate degrade на generic failure-path', async () => {
        mockCreateBusiness.mockRejectedValue(typeLimitError());
        mockListBusinesses.mockRejectedValue(new Error('network down'));
        setAuthedComplete();
        seedClaimPending();

        render(<HookHarness />);

        await waitFor(() => {
            expect(mockToastError).toHaveBeenCalled();
            expect(mockRouterReplace).toHaveBeenCalledWith(
                '/business/new?from=landing'
            );
            expect(useQrLandingDraftStore.getState().intent).toBe(
                'claim-failed-business'
            );
        });
    });
});

describe('useClaimLandingDraft — onboarding-completion-trigger (гілка B)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useQrLandingDraftStore.getState().clearAll();
        useAuthStore.getState().clearUser();
        localStorage.clear();
    });

    it('перехід incomplete→complete (PATCH /users/me success) тригерить hook автоматично', async () => {
        mockCreateBusiness.mockResolvedValue({ slug: 'iva-X3kQ' });
        mockCreateAccount.mockResolvedValue({ slug: 'acc-aB12cD34' });
        setAuthedIncomplete();
        seedClaimPending();

        render(<HookHarness />);

        expect(mockCreateBusiness).not.toHaveBeenCalled();

        act(() => {
            setAuthedComplete();
        });

        await waitFor(() => {
            expect(mockCreateBusiness).toHaveBeenCalled();
        });
    });
});

describe('useClaimLandingDraft — race-protection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useQrLandingDraftStore.getState().clearAll();
        useAuthStore.getState().clearUser();
        localStorage.clear();
    });

    it('два паралельні store-update тригери → POST1 викликається один раз', async () => {
        let resolvePromise: (value: { slug: string }) => void = () => {};
        mockCreateBusiness.mockReturnValue(
            new Promise((resolve) => {
                resolvePromise = resolve;
            })
        );

        setAuthedComplete();
        seedClaimPending();

        render(<HookHarness />);

        await waitFor(() =>
            expect(mockCreateBusiness).toHaveBeenCalledTimes(1)
        );

        act(() => {
            useQrLandingDraftStore.getState().setFormData({ ...VALID_FORM });
        });

        expect(mockCreateBusiness).toHaveBeenCalledTimes(1);

        // Cleanup pending promise so afterEach has a clean slate.
        act(() => {
            resolvePromise({ slug: 'iva-X3kQ' });
        });
    });
});

describe('useClaimLandingDraft — tab-close mid-flight resumption (SP-7)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useQrLandingDraftStore.getState().clearAll();
        useAuthStore.getState().clearUser();
        localStorage.clear();
    });

    it('mount з persisted intent=claim-business-pending → reset на idle + info-toast, БЕЗ auto-POST', async () => {
        setAuthedComplete();
        useQrLandingDraftStore.getState().setFormData(VALID_FORM);
        useQrLandingDraftStore.setState({
            intent: 'claim-business-pending',
            claimIdempotencyKey: UUID,
        });

        render(<HookHarness />);

        await waitFor(() => {
            expect(useQrLandingDraftStore.getState().intent).toBe('idle');
            expect(mockToastInfo).toHaveBeenCalled();
        });
        expect(mockCreateBusiness).not.toHaveBeenCalled();
    });

    it('mount з persisted intent=claim-account-pending → reset на idle + info-toast, БЕЗ auto-POST', async () => {
        setAuthedComplete();
        useQrLandingDraftStore.getState().setFormData(VALID_FORM);
        useQrLandingDraftStore.setState({
            intent: 'claim-account-pending',
            claimIdempotencyKey: UUID,
        });

        render(<HookHarness />);

        await waitFor(() => {
            expect(useQrLandingDraftStore.getState().intent).toBe('idle');
            expect(mockToastInfo).toHaveBeenCalled();
        });
        expect(mockCreateBusiness).not.toHaveBeenCalled();
        expect(mockCreateAccount).not.toHaveBeenCalled();
    });

    it('regression: live setIntent на claim-business-pending під час in-flight claim НЕ тригерить recovery-toast (mount-only-snapshot)', async () => {
        // Sprint 10 review fix — recovery-effect має зчитати intent рівно
        // на mount через `getState()`-snapshot. Якщо би effect був reactive
        // на live `intent`-deps, main-effect, перейшовши у
        // 'claim-business-pending' під час runClaimChain, тригернув би
        // false-positive recovery-toast одразу перед success-toast того
        // самого flow.
        mockCreateBusiness.mockResolvedValue({ slug: 'iva-X3kQ' });
        mockCreateAccount.mockResolvedValue({ slug: 'acc-aB12cD34' });
        setAuthedComplete();
        seedClaimPending();

        render(<HookHarness />);

        await waitFor(() => {
            expect(mockToastSuccess).toHaveBeenCalledWith(
                'Отримувача і реквізити збережено'
            );
        });

        // Recovery-toast НЕ виникав — тільки success.
        expect(mockToastInfo).not.toHaveBeenCalled();
    });
});
