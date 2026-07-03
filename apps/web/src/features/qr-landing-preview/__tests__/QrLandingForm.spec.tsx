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

const mockFetchQrPreview = jest.fn();
const mockToastError = jest.fn();

jest.mock('../api', () => ({
    fetchQrPreview: (...args: unknown[]) => mockFetchQrPreview(...args),
}));

jest.mock('sonner', () => ({
    toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

import {
    QrPreviewInputSchema,
    type QrPreviewInput,
} from '@finly/types';

import { QrLandingForm } from '../QrLandingForm';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';

const VALID_IBAN = 'UA213223130000026007233566001';
const VALID_RNOKPP = '1234567899';

/**
 * Test-harness: Form тепер приймає `form`-instance як prop (lift-нутий у
 * `QrLandingBlock`). У unit-тесті обгортаємо його у мінімальний компонент,
 * що створює form через `useForm` — той самий API, що Block.
 */
function FormHarness(props: { defaultValues?: Partial<QrPreviewInput> }) {
    const form = useForm<QrPreviewInput>({
        resolver: zodResolver(QrPreviewInputSchema),
        mode: 'onTouched',
        defaultValues: {
            receiverName: props.defaultValues?.receiverName ?? '',
            iban: props.defaultValues?.iban ?? '',
            taxId: props.defaultValues?.taxId ?? '',
            purpose:
                props.defaultValues?.purpose ?? 'Поповнення рахунку',
        },
    });
    return <QrLandingForm form={form} />;
}

const fillValidForm = (): void => {
    fireEvent.input(screen.getByLabelText(/Отримувач/), {
        target: { value: 'Іваненко Олена Петрівна' },
    });
    fireEvent.input(screen.getByLabelText(/IBAN/), {
        target: { value: VALID_IBAN },
    });
    fireEvent.input(screen.getByLabelText(/РНОКПП/), {
        target: { value: VALID_RNOKPP },
    });
    fireEvent.input(screen.getByLabelText(/Призначення платежу/), {
        target: { value: 'Поповнення рахунку' },
    });
};

describe('QrLandingForm', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useQrLandingDraftStore.getState().clearAll();
        localStorage.clear();
    });

    it('initial render — type badge "Фіз особа" видимий, кнопка активна', () => {
        render(<FormHarness />);
        expect(screen.getByText('Фіз особа')).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /Створити QR/ })
        ).not.toBeDisabled();
    });

    it('невалідні поля → submit не викликає API, помилки біля полів', async () => {
        render(<FormHarness />);

        fireEvent.input(screen.getByLabelText(/IBAN/), {
            target: { value: 'UA000' },
        });
        fireEvent.input(screen.getByLabelText(/Отримувач/), {
            target: { value: 'X' },
        });
        fireEvent.input(screen.getByLabelText(/РНОКПП/), {
            target: { value: '1234567899' },
        });
        fireEvent.input(screen.getByLabelText(/Призначення/), {
            target: { value: 'Тест' },
        });

        fireEvent.click(screen.getByRole('button', { name: /Створити QR/ }));

        await waitFor(() =>
            expect(
                screen.getByLabelText(/IBAN/).getAttribute('aria-invalid')
            ).toBe('true')
        );
        expect(mockFetchQrPreview).not.toHaveBeenCalled();
    });

    it('валідні дані → submit викликає fetchQrPreview і setResult у store', async () => {
        const fakeResponse = {
            link: 'https://qr.bank.gov.ua/abc',
            qrPngBase64: 'iVBORw0KGgo',
        };
        mockFetchQrPreview.mockResolvedValue(fakeResponse);

        render(<FormHarness />);
        fillValidForm();

        await waitFor(() =>
            expect(
                screen.getByRole('button', { name: /Створити QR/ })
            ).not.toBeDisabled()
        );

        fireEvent.click(screen.getByRole('button', { name: /Створити QR/ }));

        await waitFor(() => {
            expect(mockFetchQrPreview).toHaveBeenCalledWith({
                receiverName: 'Іваненко Олена Петрівна',
                iban: VALID_IBAN,
                taxId: VALID_RNOKPP,
                purpose: 'Поповнення рахунку',
            });
        });
        await waitFor(() => {
            expect(useQrLandingDraftStore.getState().result).toEqual(
                fakeResponse
            );
        });
    });

    it('default purpose = "Поповнення рахунку" (зручний дефолт для anon-flow)', () => {
        render(<FormHarness />);
        const purposeInput = screen.getByLabelText(
            /Призначення платежу/
        ) as HTMLTextAreaElement;
        expect(purposeInput.value).toBe('Поповнення рахунку');
    });

    it('відновлює defaultValues, що передав parent (UAT LAND-3 — restore from localStorage)', () => {
        render(
            <FormHarness
                defaultValues={{
                    receiverName: 'Збережене Імʼя',
                    iban: VALID_IBAN,
                    taxId: VALID_RNOKPP,
                    purpose: 'Збережене призначення',
                }}
            />
        );

        expect(
            (screen.getByLabelText(/Отримувач/) as HTMLInputElement).value
        ).toBe('Збережене Імʼя');
        expect(
            (screen.getByLabelText(/IBAN/) as HTMLInputElement).value
        ).toBe(VALID_IBAN);
        expect(
            (screen.getByLabelText(/РНОКПП/) as HTMLInputElement).value
        ).toBe(VALID_RNOKPP);
    });

    describe('error mapping (PublicApiError status-based)', () => {
        // PublicApiError несе тільки status (не body code) — Form мапить
        // за HTTP-кодом. Verify per status-family.

        const renderAndSubmit = async (): Promise<void> => {
            render(<FormHarness />);
            fillValidForm();
            await waitFor(() =>
                expect(
                    screen.getByRole('button', { name: /Створити QR/ })
                ).not.toBeDisabled()
            );
            fireEvent.click(
                screen.getByRole('button', { name: /Створити QR/ })
            );
        };

        it('429 → toast.error з повною rate-limit копією (без literal {minutes}-placeholder)', async () => {
            // Regression-guard для review-finding: до Sprint 8 §8.3 fix-у
            // `getApiMessage('RATE_LIMIT_EXCEEDED', 'qr')` робив fall-through
            // на `errors.generic.rate_limit_exceeded`, що містить
            // `{minutes}`-placeholder. Без vars interpolate() повертає
            // template as-is → користувач LAND-7 бачив `{minutes}` literal
            // у toast. Тепер `errors.qr.rate_limit_exceeded` — placeholder-
            // free копія, тому toast виглядає природно.
            const { PublicApiError } = jest.requireActual(
                '@/shared/api/client'
            ) as { PublicApiError: new (s: number, t: string) => Error };
            mockFetchQrPreview.mockRejectedValue(
                new PublicApiError(429, 'Too Many Requests')
            );

            await renderAndSubmit();

            await waitFor(() => expect(mockToastError).toHaveBeenCalled());
            const msg = mockToastError.mock.calls[0]![0] as string;
            expect(msg).toBe(
                'Забагато запитів. Зачекайте хвилину і спробуйте ще раз'
            );
            // Explicit guard проти literal placeholder-leak.
            expect(msg).not.toMatch(/\{minutes\}/);
        });

        it('400 → toast.error з PAYLOAD_TOO_LARGE копією', async () => {
            const { PublicApiError } = jest.requireActual(
                '@/shared/api/client'
            ) as { PublicApiError: new (s: number, t: string) => Error };
            mockFetchQrPreview.mockRejectedValue(
                new PublicApiError(400, 'Bad Request')
            );

            await renderAndSubmit();

            await waitFor(() => expect(mockToastError).toHaveBeenCalled());
            const msg = mockToastError.mock.calls[0]![0] as string;
            expect(msg).toMatch(/QR-код|вміщуються|Скоротіть/);
        });

        it('500 → toast.error з generic INTERNAL_ERROR копією', async () => {
            const { PublicApiError } = jest.requireActual(
                '@/shared/api/client'
            ) as { PublicApiError: new (s: number, t: string) => Error };
            mockFetchQrPreview.mockRejectedValue(
                new PublicApiError(500, 'Internal Server Error')
            );

            await renderAndSubmit();

            await waitFor(() => expect(mockToastError).toHaveBeenCalled());
        });

        it('non-PublicApiError (мережа / Zod parse) → toast.error generic', async () => {
            mockFetchQrPreview.mockRejectedValue(new Error('network down'));

            await renderAndSubmit();

            await waitFor(() => expect(mockToastError).toHaveBeenCalled());
        });
    });
});
