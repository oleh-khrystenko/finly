import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

jest.mock('@/shared/config', () => ({
    ENV: {
        NEXT_PUBLIC_API_URL: 'http://localhost:4000/api',
        NEXT_PUBLIC_BASE_URL: 'http://localhost:3000',
        NEXT_PUBLIC_PAY_PUBLIC_URL: 'http://localhost:3001',
    },
}));

const mockClaim = jest.fn();
const mockRouterPush = jest.fn();
const mockRouterReplace = jest.fn();
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
const mockClipboardWrite = jest.fn();

jest.mock('../api', () => ({
    claimLandingDraftAsBusiness: (...args: unknown[]) => mockClaim(...args),
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({
        push: mockRouterPush,
        replace: mockRouterReplace,
    }),
}));

jest.mock('sonner', () => ({
    toast: {
        success: (...args: unknown[]) => mockToastSuccess(...args),
        error: (...args: unknown[]) => mockToastError(...args),
    },
}));

import {
    QrPreviewInputSchema,
    type QrPreviewInput,
} from '@finly/types';

import { QrLandingResult } from '../QrLandingResult';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';
import { useAuthStore } from '@/entities/user';

const VALID_FORM = {
    receiverName: 'Іваненко',
    iban: 'UA213223130000026007233566001',
    taxId: '1234567899',
    purpose: 'Поповнення рахунку',
};

const VALID_RESULT = {
    link: 'https://qr.bank.gov.ua/eyJ0eXAiOiJKV1Qi',
    qrPngBase64: 'iVBORw0KGgoAAAA',
};

/**
 * Test-harness: Result тепер приймає `form`-instance як prop. Обгортаємо
 * у компонент з `useForm` тих самих defaults, що QrLandingBlock на mount.
 * Дає доступ до form-state у тестах через `formRef`-callback.
 */
function ResultHarness(props: {
    initialForm?: Partial<QrPreviewInput>;
    onForm?: (form: ReturnType<typeof useForm<QrPreviewInput>>) => void;
}) {
    const form = useForm<QrPreviewInput>({
        resolver: zodResolver(QrPreviewInputSchema),
        mode: 'onChange',
        defaultValues: {
            receiverName: props.initialForm?.receiverName ?? '',
            iban: props.initialForm?.iban ?? '',
            taxId: props.initialForm?.taxId ?? '',
            purpose:
                props.initialForm?.purpose ?? 'Поповнення рахунку',
        },
    });
    if (props.onForm) props.onForm(form);
    return <QrLandingResult form={form} />;
}

const seedFilledState = (): void => {
    useQrLandingDraftStore.getState().setFormData(VALID_FORM);
    useQrLandingDraftStore.getState().setResult(VALID_RESULT);
};

const setAnonAuth = (): void => {
    useAuthStore.getState().clearUser();
};

const setAuthedWithCompleteProfile = (): void => {
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

const setAuthedWithIncompleteProfile = (): void => {
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

describe('QrLandingResult — empty / filled state', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useQrLandingDraftStore.getState().clearAll();
        useAuthStore.getState().clearUser();
        localStorage.clear();
        Object.assign(navigator, {
            clipboard: { writeText: mockClipboardWrite },
        });
    });

    it('empty-state коли result = null — показує placeholder microcopy', () => {
        render(<ResultHarness />);
        expect(
            screen.getByText(/QR-код зʼявиться тут після введення даних/)
        ).toBeInTheDocument();
    });

    it('filled-state — рендерить UiQrImage + truncated link + warning', () => {
        seedFilledState();
        render(<ResultHarness initialForm={VALID_FORM} />);

        const img = screen.getByAltText(/Платіжний QR-код/);
        expect(img).toBeInTheDocument();
        expect(img.getAttribute('src')).toContain(
            'data:image/png;base64,iVBORw0KGgoAAAA'
        );
        expect(screen.getByText(/qr\.bank\.gov\.ua\/eyJ0eXAiOi…/)).toBeInTheDocument();
        expect(
            screen.getByText(/не зберігаються на нашому сервері/)
        ).toBeInTheDocument();
    });
});

describe('QrLandingResult — copy + clear actions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useQrLandingDraftStore.getState().clearAll();
        useAuthStore.getState().clearUser();
        localStorage.clear();
        Object.assign(navigator, {
            clipboard: { writeText: mockClipboardWrite },
        });
    });

    it('"Скопіювати посилання" викликає clipboard.writeText з повним link', async () => {
        seedFilledState();
        mockClipboardWrite.mockResolvedValue(undefined);
        render(<ResultHarness initialForm={VALID_FORM} />);

        fireEvent.click(
            screen.getByRole('button', { name: /Скопіювати посилання/ })
        );

        await waitFor(() => {
            expect(mockClipboardWrite).toHaveBeenCalledWith(VALID_RESULT.link);
            expect(mockToastSuccess).toHaveBeenCalledWith(
                'Посилання скопійовано'
            );
        });
    });

    it('"Очистити" — clearAll() + form.reset() (input.values стають порожніми)', () => {
        seedFilledState();

        // Захоплюємо form-instance, щоб перевірити reset.
        let formRef: ReturnType<typeof useForm<QrPreviewInput>> | null = null;
        render(
            <ResultHarness
                initialForm={VALID_FORM}
                onForm={(f) => {
                    formRef = f;
                }}
            />
        );

        // Sanity: defaults підставлені
        expect(formRef!.getValues('receiverName')).toBe('Іваненко');

        fireEvent.click(screen.getByRole('button', { name: /Очистити/ }));

        // Store очищено
        const s = useQrLandingDraftStore.getState();
        expect(s.formData).toEqual({});
        expect(s.result).toBeNull();
        expect(s.intent).toBe('idle');

        // Form values очищено — UAT LAND-3-related інваріант
        expect(formRef!.getValues('receiverName')).toBe('');
        expect(formRef!.getValues('iban')).toBe('');
        expect(formRef!.getValues('taxId')).toBe('');
        // Purpose повертається до сенсового дефолту, не порожнього рядка.
        expect(formRef!.getValues('purpose')).toBe('Поповнення рахунку');

        expect(mockToastSuccess).toHaveBeenCalledWith('Дані очищено');
    });
});

describe('QrLandingResult — claim CTA по auth-state', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useQrLandingDraftStore.getState().clearAll();
        useAuthStore.getState().clearUser();
        localStorage.clear();
        Object.assign(navigator, {
            clipboard: { writeText: mockClipboardWrite },
        });
    });

    it('anon: setIntent("claim-pending") + router.push("/auth/signin")', () => {
        seedFilledState();
        setAnonAuth();
        render(<ResultHarness initialForm={VALID_FORM} />);

        fireEvent.click(
            screen.getByRole('button', { name: /Зберегти у кабінет/ })
        );

        expect(useQrLandingDraftStore.getState().intent).toBe('claim-pending');
        expect(mockRouterPush).toHaveBeenCalledWith('/auth/signin');
        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('logged-in + complete profile: claim → router.replace + form.reset', async () => {
        seedFilledState();
        setAuthedWithCompleteProfile();
        mockClaim.mockResolvedValue({ slug: 'iva-X3kQ' });

        let formRef: ReturnType<typeof useForm<QrPreviewInput>> | null = null;
        render(
            <ResultHarness
                initialForm={VALID_FORM}
                onForm={(f) => {
                    formRef = f;
                }}
            />
        );

        fireEvent.click(
            screen.getByRole('button', { name: /Зберегти у кабінет/ })
        );

        await waitFor(() => {
            expect(mockClaim).toHaveBeenCalledWith(VALID_FORM);
            expect(mockRouterReplace).toHaveBeenCalledWith(
                '/business/iva-X3kQ?completed-from=landing'
            );
            expect(mockToastSuccess).toHaveBeenCalledWith('Бізнес створено');
            expect(useQrLandingDraftStore.getState().formData).toEqual({});
        });

        // Form reset відбувся — input cleared (UX consistency на success-path).
        expect(formRef!.getValues('receiverName')).toBe('');
    });

    it('logged-in + incomplete profile: setIntent + redirect на /profile?mode=new', () => {
        seedFilledState();
        setAuthedWithIncompleteProfile();
        render(<ResultHarness initialForm={VALID_FORM} />);

        fireEvent.click(
            screen.getByRole('button', { name: /Зберегти у кабінет/ })
        );

        expect(useQrLandingDraftStore.getState().intent).toBe('claim-pending');
        expect(mockRouterPush).toHaveBeenCalledWith('/profile?mode=new');
        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('schema-drift у localStorage: невалідний formData → toast.error без API-виклику', () => {
        useQrLandingDraftStore.getState().setFormData({
            receiverName: '',
            iban: 'invalid',
            taxId: '123',
            purpose: 'x',
        });
        useQrLandingDraftStore.getState().setResult(VALID_RESULT);
        setAuthedWithCompleteProfile();
        render(<ResultHarness />);

        fireEvent.click(
            screen.getByRole('button', { name: /Зберегти у кабінет/ })
        );

        expect(mockToastError).toHaveBeenCalled();
        expect(mockClaim).not.toHaveBeenCalled();
    });
});
