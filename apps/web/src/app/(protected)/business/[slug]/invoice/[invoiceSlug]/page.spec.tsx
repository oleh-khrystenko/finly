import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type {
    BusinessWithInvoicesCount,
    Invoice,
    PublicInvoiceView,
} from '@finly/types';

const mockGetBusinessBySlug = jest.fn();
const mockGetInvoiceBySlug = jest.fn();
const mockGetPublicInvoiceView = jest.fn();
const mockReplace = jest.fn();
const mockOpenDeleteConfirm = jest.fn();

jest.mock('@/shared/api', () => ({
    getApiMessage: jest.fn((code: string) => `[${code}]`),
    getBusinessBySlug: (...a: unknown[]) => mockGetBusinessBySlug(...a),
    getInvoiceBySlug: (...a: unknown[]) => mockGetInvoiceBySlug(...a),
    getPublicInvoiceView: (...a: unknown[]) => mockGetPublicInvoiceView(...a),
    updateInvoice: jest.fn(),
}));

jest.mock('next/navigation', () => ({
    useParams: () => ({ slug: 'IvanEnko', invoiceSlug: 'inv-001-aB3xQ9k7' }),
    useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('@/features/invoice-edit', () => ({
    AmountSection: () => <div data-testid="section-amount">Сума</div>,
    PurposeSection: () => <div data-testid="section-purpose">Призначення</div>,
    ValidUntilSection: () => (
        <div data-testid="section-validuntil">Термін</div>
    ),
    SlugSection: () => <div data-testid="section-slug">Slug</div>,
    InvoiceQrSection: () => <div data-testid="section-qr">QR</div>,
    scheduleInvoiceDeleteWithUndo: jest.fn(),
    useDeleteInvoiceConfirmStore: (
        selector: (s: { open: typeof mockOpenDeleteConfirm }) => unknown,
    ) => selector({ open: mockOpenDeleteConfirm }),
}));

jest.mock('@/features/invoice-public', () => ({
    InvoicePublicView: () => (
        <div data-testid="invoice-public-view">Public view</div>
    ),
}));

jest.mock('@/shared/config/env', () => ({
    ENV: { NEXT_PUBLIC_PAY_PUBLIC_URL: 'https://pay.finly.local' },
}));

import InvoiceCabinetPage from './page';

const business: BusinessWithInvoicesCount = {
    id: '507f1f77bcf86cd799439011',
    type: 'fop',
    ownerId: '507f1f77bcf86cd799439012',
    managers: [],
    slug: 'IvanEnko',
    slugLower: 'ivanenko',
    name: 'ФОП Іваненко',
    requisites: { iban: 'UA213223130000026007233566001', taxId: '1234567899' },
    taxationSystem: 'simplified-3',
    isVatPayer: false,
    paymentPurposeTemplate: 'Оплата за послуги',
    acceptedBanks: ['privatbank'],
    seoIndexEnabled: false,
    invoiceSlugPresetDefault: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    invoicesCount: 1,
};

const invoice: Invoice = {
    id: '507f1f77bcf86cd799439021',
    businessId: business.id,
    slug: 'inv-001-aB3xQ9k7',
    amount: 150000,
    amountLocked: true,
    paymentPurpose: 'Оплата',
    validUntil: null,
    slugPreset: 'simple',
    slugCounterScope: 'simple',
    slugCounter: 1,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
};

const publicView: PublicInvoiceView = {
    amount: 150000,
    amountLocked: true,
    paymentPurpose: 'Оплата',
    validUntil: null,
    slug: invoice.slug,
    business: {
        type: 'fop',
        name: 'ФОП Іваненко',
        slug: 'IvanEnko',
        acceptedBanks: ['privatbank'],
    },
    nbuLinks: {
        primary: 'https://qr.bank.gov.ua/abc',
        legacy: 'https://bank.gov.ua/qr/abc',
    },
};

beforeEach(() => {
    mockGetBusinessBySlug.mockReset();
    mockGetInvoiceBySlug.mockReset();
    mockGetPublicInvoiceView.mockReset();
    mockReplace.mockReset();
    mockOpenDeleteConfirm.mockReset();
    mockGetBusinessBySlug.mockResolvedValue(business);
    mockGetInvoiceBySlug.mockResolvedValue(invoice);
    mockGetPublicInvoiceView.mockResolvedValue(publicView);
});

describe('InvoiceCabinetPage (Sprint 4 §4.6 DoD smoke)', () => {
    it('показує spinner до отримання обох responses', () => {
        mockGetBusinessBySlug.mockReturnValue(new Promise(() => {}));
        mockGetInvoiceBySlug.mockReturnValue(new Promise(() => {}));
        const { container } = render(<InvoiceCabinetPage />);
        expect(container.querySelector('svg')).toBeTruthy();
    });

    it('рендерить heading з invoice slug + amount (Plan: "Рахунок №… — {amount-formatted}")', async () => {
        render(<InvoiceCabinetPage />);
        await waitFor(() => {
            expect(screen.getByText(/№inv-001-aB3xQ9k7/)).toBeInTheDocument();
        });
        // Amount-частина після em-dash:
        expect(screen.getByText(/1\s500,00\s?₴/)).toBeInTheDocument();
    });

    it('рендерить heading без amount-частини коли invoice.amount=null', async () => {
        mockGetInvoiceBySlug.mockResolvedValue({
            ...invoice,
            amount: null,
            amountLocked: false,
        });
        render(<InvoiceCabinetPage />);
        await waitFor(() => {
            expect(screen.getByText(/№inv-001-aB3xQ9k7/)).toBeInTheDocument();
        });
        // Без "—" + amount.
        expect(screen.queryByText(/—/)).not.toBeInTheDocument();
    });

    it('рендерить усі 6 карток (Sprint 4 §4.6 DoD)', async () => {
        render(<InvoiceCabinetPage />);
        await waitFor(() => {
            expect(screen.getByTestId('section-amount')).toBeInTheDocument();
        });
        expect(screen.getByTestId('section-purpose')).toBeInTheDocument();
        expect(screen.getByTestId('section-validuntil')).toBeInTheDocument();
        expect(screen.getByTestId('section-slug')).toBeInTheDocument();
        expect(screen.getByTestId('section-qr')).toBeInTheDocument();
        // 6-та — Danger zone (inline у page-tsx)
        expect(screen.getByText('Небезпечна зона')).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /Видалити рахунок/ }),
        ).toBeInTheDocument();
    });

    it('preview-toggle вмикає InvoicePublicView (SP-2 prefetch-on-mount)', async () => {
        render(<InvoiceCabinetPage />);
        await waitFor(() =>
            expect(screen.getByTestId('section-amount')).toBeInTheDocument(),
        );
        // Перемикаємо toggle
        const toggleSwitch = screen.getByRole('switch', {
            name: /Перегляд як клієнт/,
        });
        toggleSwitch.click();
        await waitFor(() =>
            expect(
                screen.getByTestId('invoice-public-view'),
            ).toBeInTheDocument(),
        );
    });

    it('"Відкрити в новій вкладці" має href=public URL з business+invoice slug', async () => {
        render(<InvoiceCabinetPage />);
        await waitFor(() =>
            expect(screen.getByTestId('section-amount')).toBeInTheDocument(),
        );
        const link = screen.getByRole('link', {
            name: /Відкрити в новій вкладці/,
        });
        expect(link.getAttribute('href')).toMatch(
            /\/IvanEnko\/inv-001-aB3xQ9k7$/,
        );
        expect(link).toHaveAttribute('target', '_blank');
    });

    it('"Видалити рахунок" → відкриває confirm-modal (Sprint 3 patern consistency)', async () => {
        render(<InvoiceCabinetPage />);
        await waitFor(() =>
            expect(screen.getByTestId('section-amount')).toBeInTheDocument(),
        );
        const deleteBtn = screen.getByRole('button', {
            name: /Видалити рахунок/,
        });
        deleteBtn.click();
        expect(mockOpenDeleteConfirm).toHaveBeenCalledTimes(1);
        // Перший аргумент — invoice document; другий — onConfirm callback.
        expect(mockOpenDeleteConfirm.mock.calls[0]![0].slug).toBe(
            'inv-001-aB3xQ9k7',
        );
        expect(typeof mockOpenDeleteConfirm.mock.calls[0]![1]).toBe(
            'function',
        );
    });

    it('error 404 INVOICE_NOT_FOUND → ErrorPage з "Рахунок не знайдено"', async () => {
        const { AxiosError } = await import('axios');
        const err = new AxiosError(
            'not found',
            'ERR_BAD_REQUEST',
            undefined,
            undefined,
            // @ts-expect-error — minimal mock-shape
            {
                status: 404,
                data: { error: { code: 'INVOICE_NOT_FOUND' } },
            },
        );
        mockGetInvoiceBySlug.mockRejectedValue(err);
        render(<InvoiceCabinetPage />);
        await waitFor(() => {
            expect(screen.getByText('Рахунок не знайдено')).toBeInTheDocument();
        });
    });
});
