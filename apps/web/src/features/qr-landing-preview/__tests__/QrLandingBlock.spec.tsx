import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';

jest.mock('@/shared/config', () => ({
    ENV: {
        NEXT_PUBLIC_API_URL: 'http://localhost:4000/api',
        NEXT_PUBLIC_BASE_URL: 'http://localhost:3000',
        NEXT_PUBLIC_PAY_PUBLIC_URL: 'http://localhost:3001',
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('sonner', () => ({
    toast: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('../api', () => ({
    fetchQrPreview: jest.fn(),
    createBusinessFromDraft: jest.fn(),
    createAccountFromDraft: jest.fn(),
}));

// Mock useHasHydrated як ручний controller — даємо тестам моментально
// перемикати hydration-state без імітації Zustand persist-механіки.
let mockHasHydratedValue = true;
jest.mock('@/shared/lib', () => {
    const actual = jest.requireActual('@/shared/lib');
    return {
        ...actual,
        useHasHydrated: () => mockHasHydratedValue,
    };
});

import { QrLandingBlock } from '../QrLandingBlock';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';

const VALID_FORM = {
    receiverName: 'Іваненко',
    iban: 'UA213223130000026007233566001',
    taxId: '1234567899',
    purpose: 'Поповнення рахунку',
};

describe('QrLandingBlock — hydration gate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useQrLandingDraftStore.getState().clearAll();
        localStorage.clear();
        mockHasHydratedValue = true;
    });

    it('hasHydrated=false: показує skeleton, НЕ form/result', () => {
        mockHasHydratedValue = false;
        render(<QrLandingBlock />);

        expect(
            screen.getByLabelText(/Завантажуємо форму/)
        ).toBeInTheDocument();
        expect(screen.queryByLabelText(/Форма генерації/)).not.toBeInTheDocument();
    });

    it('hasHydrated=true: рендерить form з persisted defaultValues (UAT LAND-3 — restore from localStorage)', () => {
        useQrLandingDraftStore.getState().setFormData(VALID_FORM);
        mockHasHydratedValue = true;

        render(<QrLandingBlock />);

        // Form з'явилася
        expect(
            screen.getByLabelText(/Форма генерації/)
        ).toBeInTheDocument();

        // Persisted values відновлені у input-ах (це і є найголовніше для
        // sprint plan UAT LAND-3 — без hydration-gate цей invariant ламався).
        expect(
            (screen.getByLabelText(/Отримувач/) as HTMLInputElement).value
        ).toBe(VALID_FORM.receiverName);
        expect(
            (screen.getByLabelText(/IBAN/) as HTMLInputElement).value
        ).toBe(VALID_FORM.iban);
        expect(
            (screen.getByLabelText(/РНОКПП/) as HTMLInputElement).value
        ).toBe(VALID_FORM.taxId);
    });

    it('header (h2 + intro) рендериться завжди — навіть до hydration (SEO crawl)', () => {
        mockHasHydratedValue = false;
        render(<QrLandingBlock />);

        expect(screen.getByText('Спробуйте прямо зараз')).toBeInTheDocument();
        expect(
            screen.getByText(/Введіть реквізити — система згенерує QR-код/)
        ).toBeInTheDocument();
    });
});
