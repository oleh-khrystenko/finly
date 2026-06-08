import React from 'react';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import type { Account, Business, Invoice } from '@finly/types';

const mockCreateInvoice = jest.fn();
const mockUpdateAccount = jest.fn();
const mockReplace = jest.fn();
const mockOpenWarning = jest.fn();

jest.mock('@/shared/api', () => ({
    createInvoice: (...args: unknown[]) => mockCreateInvoice(...args),
    updateAccount: (...args: unknown[]) => mockUpdateAccount(...args),
    getApiMessage: jest.fn((code: string) => `[${code}]`),
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: mockReplace }),
}));

// requireActual: picker/helpers лишаються справжніми, мокаємо лише warning-store.
jest.mock('@/entities/invoice', () => {
    const actual =
        jest.requireActual<typeof import('@/entities/invoice')>(
            '@/entities/invoice'
        );
    return {
        ...actual,
        useSlugPresetWarningStore: (
            selector: (state: { open: typeof mockOpenWarning }) => unknown
        ) => selector({ open: mockOpenWarning }),
    };
});

import CreateInvoiceForm from './CreateInvoiceForm';

const VALID_IBAN = 'UA213223130000026007233566001';
const VALID_TAX_ID = '1234567899';

/**
 * Sprint 9 §9.2 — Business shape без `requisites` (taxId top-level, IBAN на
 * Account); `invoiceSlugPresetDefault` переніс власника на Account.
 */
const baseBusiness: Business = {
    id: '507f1f77bcf86cd799439011',
    type: 'fop',
    ownerId: '507f1f77bcf86cd799439012',
    managers: [],
    slug: 'IvanEnko',
    slugLower: 'ivanenko',
    name: 'ФОП Іваненко',
    taxId: VALID_TAX_ID,
    taxationSystem: 'simplified-3',
    isVatPayer: false,
    paymentPurposeTemplate: 'Оплата за послуги',
    seoIndexEnabled: false,
    deletedAt: null,
    createdAt: new Date('2026-05-01T10:00:00Z'),
    updatedAt: new Date('2026-05-01T10:00:00Z'),
};

const baseAccount: Account = {
    id: '507f1f77bcf86cd799439055',
    businessId: baseBusiness.id,
    iban: VALID_IBAN,
    name: 'ПриватБанк •6001',
    slug: 'aB3xQ9k7',
    slugLower: 'ab3xq9k7',
    bankCode: 'privatbank',
    invoiceSlugPresetDefault: null,
    deletedAt: null,
    createdAt: new Date('2026-05-01T10:00:00Z'),
    updatedAt: new Date('2026-05-01T10:00:00Z'),
};

function renderForm(overrides?: {
    business?: Business;
    account?: Account;
}): void {
    render(
        <CreateInvoiceForm
            business={overrides?.business ?? baseBusiness}
            account={overrides?.account ?? baseAccount}
        />
    );
}

const ROBUST_INVOICE: Invoice = {
    id: '507f1f77bcf86cd799439021',
    businessId: baseBusiness.id,
    accountId: baseAccount.id,
    slug: 'inv-001-aB3xQ9k7',
    slugLower: 'inv-001-ab3xq9k7',
    amount: null,
    amountLocked: false,
    paymentPurpose: null,
    validUntil: null,
    slugPreset: 'simple',
    slugCounterScope: 'simple',
    slugCounter: 1,
    payeeSnapshot: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
};

beforeEach(() => {
    mockCreateInvoice.mockReset();
    mockUpdateAccount.mockReset();
    mockReplace.mockReset();
    mockOpenWarning.mockReset();
    mockCreateInvoice.mockResolvedValue(ROBUST_INVOICE);
    mockUpdateAccount.mockResolvedValue(baseAccount);
});

/**
 * Sprint 4 §4.5 DoD + Sprint 9 §SP-6: усі 6 dropdown-опцій (explicit +
 * 4 пресети + random) дають valid POST з правильним `slugInput.kind`
 * discriminator-ом. Sprint 9 — `createInvoice(businessSlug, accountSlug, ...)`
 * 3-arg signature.
 */
describe('CreateInvoiceForm — slugInput happy paths', () => {
    // Sprint 17 — формат тепер radio-картки (`InvoiceFormatPicker`), не dropdown.
    async function selectSlugOption(name: RegExp | string): Promise<void> {
        const radio = screen.getByRole('radio', { name });
        await act(async () => {
            fireEvent.click(radio);
        });
    }

    async function clickSubmit(): Promise<void> {
        const submitBtn = screen.getByRole('button', {
            name: /Створити рахунок/,
        });
        await act(async () => {
            fireEvent.click(submitBtn);
        });
    }

    it('default: kind="preset", preset="simple" коли account.invoiceSlugPresetDefault=null', async () => {
        renderForm();
        await clickSubmit();
        await waitFor(() => expect(mockCreateInvoice).toHaveBeenCalled());

        const [businessSlug, accountSlug, payload] =
            mockCreateInvoice.mock.calls[0]!;
        expect(businessSlug).toBe(baseBusiness.slug);
        expect(accountSlug).toBe(baseAccount.slug);
        expect(payload.slugInput).toEqual({
            kind: 'preset',
            preset: 'simple',
        });
    });

    it('default mount = "with-month" коли account.invoiceSlugPresetDefault="with-month"', async () => {
        renderForm({
            account: { ...baseAccount, invoiceSlugPresetDefault: 'with-month' },
        });
        await clickSubmit();
        await waitFor(() => expect(mockCreateInvoice).toHaveBeenCalled());
        expect(mockCreateInvoice.mock.calls[0]![2].slugInput).toEqual({
            kind: 'preset',
            preset: 'with-month',
        });
    });

    it('default mount = "with-purpose" БЕЗ автоматичного warning-modal (DoD edge-case)', async () => {
        renderForm({
            account: {
                ...baseAccount,
                invoiceSlugPresetDefault: 'with-purpose',
            },
            business: { ...baseBusiness, paymentPurposeTemplate: 'Послуги' },
        });
        expect(mockOpenWarning).not.toHaveBeenCalled();

        await clickSubmit();
        await waitFor(() => expect(mockCreateInvoice).toHaveBeenCalled());
        expect(mockCreateInvoice.mock.calls[0]![2].slugInput).toEqual({
            kind: 'preset',
            preset: 'with-purpose',
        });
    });

    it.each([
        [/Послідовний/, { kind: 'preset', preset: 'simple' }],
        [/Рік і місяць/, { kind: 'preset', preset: 'with-month' }],
        [/рік-001/, { kind: 'preset', preset: 'with-year' }],
        [/Випадковий код/, { kind: 'random' }],
    ] as const)(
        'manual select "%s" → POST.slugInput shape correct',
        async (label, expected) => {
            renderForm();
            await selectSlugOption(label);
            await clickSubmit();
            await waitFor(() => expect(mockCreateInvoice).toHaveBeenCalled());
            expect(mockCreateInvoice.mock.calls[0]![2].slugInput).toEqual(
                expected
            );
        }
    );

    it('"Ввести самому" + valid humanPart → POST {kind:"explicit", humanPart}', async () => {
        renderForm();
        await selectSlugOption(/Ввести самому/);
        const input = await screen.findByPlaceholderText(/order-1024/);
        await act(async () => {
            fireEvent.change(input, {
                target: { value: 'order-1024' },
            });
        });
        await clickSubmit();
        await waitFor(() => expect(mockCreateInvoice).toHaveBeenCalled());
        expect(mockCreateInvoice.mock.calls[0]![2].slugInput).toEqual({
            kind: 'explicit',
            humanPart: 'order-1024',
        });
    });
});

describe('CreateInvoiceForm — humanPart live-validation', () => {
    async function chooseExplicit(): Promise<HTMLElement> {
        renderForm();
        await act(async () => {
            fireEvent.click(
                screen.getByRole('radio', { name: /Ввести самому/ })
            );
        });
        return screen.findByPlaceholderText(/order-1024/);
    }

    it.each([
        ['UPPER-case', 'INVALID'],
        ['leading dash', '-invalid'],
        ['trailing dash', 'invalid-'],
        ['consecutive dashes', 'in--valid'],
        ['empty', ''],
    ] as const)(
        'live-error для invalid humanPart: %s',
        async (_label, value) => {
            const input = await chooseExplicit();
            await act(async () => {
                fireEvent.change(input, { target: { value } });
            });
            await act(async () => {
                fireEvent.click(
                    screen.getByRole('button', {
                        name: /Створити рахунок/,
                    })
                );
            });
            expect(mockCreateInvoice).not.toHaveBeenCalled();
        }
    );

    it('valid humanPart → submit unblocked', async () => {
        const input = await chooseExplicit();
        await act(async () => {
            fireEvent.change(input, {
                target: { value: 'inv-2026' },
            });
        });
        await act(async () => {
            fireEvent.click(
                screen.getByRole('button', {
                    name: /Створити рахунок/,
                })
            );
        });
        await waitFor(() => expect(mockCreateInvoice).toHaveBeenCalled());
    });
});

describe('CreateInvoiceForm — coupled amount × amountLocked (SP-6)', () => {
    it('amount=null → switch disabled, aria-checked=true', () => {
        renderForm();
        const lockSwitch = document.getElementById('amount-lock-switch')!;
        expect(lockSwitch).toBeDisabled();
        expect(lockSwitch).toHaveAttribute('aria-checked', 'true');
    });

    it('amount=number → switch enabled, default aria-checked=false', async () => {
        renderForm();
        const amountInput = screen.getByPlaceholderText('1500,50');
        await act(async () => {
            fireEvent.change(amountInput, { target: { value: '1500' } });
        });
        const lockSwitch = document.getElementById('amount-lock-switch')!;
        expect(lockSwitch).not.toBeDisabled();
        expect(lockSwitch).toHaveAttribute('aria-checked', 'false');
    });

    it('UA-кома: 1500,50 → switch enabled, default locked', async () => {
        renderForm();
        const amountInput = screen.getByPlaceholderText('1500,50');
        await act(async () => {
            fireEvent.change(amountInput, { target: { value: '1500,50' } });
        });
        const lockSwitch = document.getElementById('amount-lock-switch')!;
        expect(lockSwitch).not.toBeDisabled();
        expect(lockSwitch).toHaveAttribute('aria-checked', 'false');
    });

    it('transient invalid input → amountLocked НЕ скидається', async () => {
        renderForm();
        const amountInput = screen.getByPlaceholderText('1500,50');
        const lockSwitch = document.getElementById('amount-lock-switch')!;

        await act(async () => {
            fireEvent.change(amountInput, { target: { value: '1500' } });
        });
        expect(lockSwitch).not.toBeDisabled();
        expect(lockSwitch).toHaveAttribute('aria-checked', 'false');

        await act(async () => {
            fireEvent.click(lockSwitch);
        });
        expect(lockSwitch).toHaveAttribute('aria-checked', 'true');

        await act(async () => {
            fireEvent.change(amountInput, { target: { value: '1500abc' } });
        });
        expect(lockSwitch).toBeDisabled();
        expect(lockSwitch).toHaveAttribute('aria-checked', 'true');

        await act(async () => {
            fireEvent.change(amountInput, { target: { value: '1500,50' } });
        });
        expect(lockSwitch).not.toBeDisabled();
        expect(lockSwitch).toHaveAttribute('aria-checked', 'true');
    });

    it('semantic signage → візуально ON, stored intent зберігається', async () => {
        renderForm();
        const amountInput = screen.getByPlaceholderText('1500,50');
        const lockSwitch = document.getElementById('amount-lock-switch')!;

        await act(async () => {
            fireEvent.change(amountInput, { target: { value: '1500' } });
        });
        expect(lockSwitch).toHaveAttribute('aria-checked', 'false');

        await act(async () => {
            fireEvent.change(amountInput, { target: { value: '' } });
        });
        await waitFor(() => {
            expect(lockSwitch).toHaveAttribute('aria-checked', 'true');
        });
        expect(lockSwitch).toBeDisabled();

        await act(async () => {
            fireEvent.change(amountInput, { target: { value: '2000' } });
        });
        expect(lockSwitch).not.toBeDisabled();
        expect(lockSwitch).toHaveAttribute('aria-checked', 'false');
    });
});

describe('CreateInvoiceForm — with-purpose warning modal', () => {
    it('manual select with-purpose → openWarning викликається', async () => {
        renderForm();
        await act(async () => {
            fireEvent.click(
                screen.getByRole('radio', { name: /За призначенням/ })
            );
        });
        expect(mockOpenWarning).toHaveBeenCalledTimes(1);
        expect(typeof mockOpenWarning.mock.calls[0]![0]).toBe('function');
        expect(typeof mockOpenWarning.mock.calls[0]![1]).toBe('function');
    });

    it('mount з account.invoiceSlugPresetDefault="with-purpose" → openWarning НЕ викликається (page-load)', () => {
        renderForm({
            account: {
                ...baseAccount,
                invoiceSlugPresetDefault: 'with-purpose',
            },
        });
        expect(mockOpenWarning).not.toHaveBeenCalled();
    });
});

describe('CreateInvoiceForm — запам`ятати формат за замовчуванням', () => {
    async function pickWithMonth(): Promise<void> {
        await act(async () => {
            fireEvent.click(
                screen.getByRole('radio', { name: /Рік і місяць/ })
            );
        });
    }

    async function submit(): Promise<void> {
        await act(async () => {
            fireEvent.click(
                screen.getByRole('button', { name: /Створити рахунок/ })
            );
        });
    }

    it('галочка «запам`ятати» → updateAccount з обраним форматом', async () => {
        renderForm();
        await pickWithMonth();
        await act(async () => {
            fireEvent.click(
                screen.getByRole('checkbox', {
                    name: /Запам.ятати формат для наступних рахунків/,
                })
            );
        });
        await submit();
        await waitFor(() => expect(mockCreateInvoice).toHaveBeenCalled());
        await waitFor(() => expect(mockUpdateAccount).toHaveBeenCalled());
        const [businessSlug, accountSlug, patch] =
            mockUpdateAccount.mock.calls[0]!;
        expect(businessSlug).toBe(baseBusiness.slug);
        expect(accountSlug).toBe(baseAccount.slug);
        expect(patch).toEqual({ invoiceSlugPresetDefault: 'with-month' });
    });

    it('без галочки → updateAccount НЕ викликається', async () => {
        renderForm();
        await pickWithMonth();
        await submit();
        await waitFor(() => expect(mockCreateInvoice).toHaveBeenCalled());
        expect(mockUpdateAccount).not.toHaveBeenCalled();
    });

    it('вибір збігається з домашнім форматом → галочки немає', () => {
        renderForm({
            account: { ...baseAccount, invoiceSlugPresetDefault: 'with-month' },
        });
        expect(
            screen.queryByRole('checkbox', {
                name: /Запам.ятати як формат за замовчуванням/,
            })
        ).toBeNull();
    });
});

describe('CreateInvoiceForm — required-fields validation', () => {
    it('режим "до дати" + очищена дата → submit-кнопка disabled', async () => {
        renderForm();
        const triggers = screen.getAllByRole('button');
        const validUntilTrigger = triggers.find((b) =>
            /Без терміну|До конкретної дати/.test(b.textContent ?? '')
        )!;
        await act(async () => {
            fireEvent.click(validUntilTrigger);
        });
        const option = await screen.findByRole('option', {
            name: /До конкретної дати/,
        });
        await act(async () => {
            fireEvent.click(option);
        });
        // Перемикання у «до дати» авто-заповнює завтра (спільний ValidUntilField).
        // Очищаємо вручну → draft невалідний → submit заблокований.
        const dateInput = screen.getByLabelText('Дата у форматі ДД.ММ.РРРР');
        await act(async () => {
            fireEvent.change(dateInput, { target: { value: '' } });
        });
        const submitBtn = screen.getByRole('button', {
            name: /Створити рахунок/,
        });
        expect(submitBtn).toBeDisabled();
        expect(mockCreateInvoice).not.toHaveBeenCalled();
    });

    it('режим "до дати" з авто-датою → submit передає validUntil (23:59:59 Kyiv)', async () => {
        renderForm();
        const triggers = screen.getAllByRole('button');
        const validUntilTrigger = triggers.find((b) =>
            /Без терміну|До конкретної дати/.test(b.textContent ?? '')
        )!;
        await act(async () => {
            fireEvent.click(validUntilTrigger);
        });
        const option = await screen.findByRole('option', {
            name: /До конкретної дати/,
        });
        await act(async () => {
            fireEvent.click(option);
        });
        const dateInput = screen.getByLabelText('Дата у форматі ДД.ММ.РРРР');
        await act(async () => {
            fireEvent.change(dateInput, { target: { value: '15.08.2026' } });
        });
        await act(async () => {
            fireEvent.click(
                screen.getByRole('button', { name: /Створити рахунок/ })
            );
        });
        await waitFor(() => expect(mockCreateInvoice).toHaveBeenCalledTimes(1));
        const payload = mockCreateInvoice.mock.calls[0]![2] as {
            validUntil: Date;
        };
        // 15.08.2026 23:59:59 Europe/Kyiv (літо UTC+3) = 20:59:59Z.
        expect(payload.validUntil.toISOString()).toBe(
            '2026-08-15T20:59:59.000Z'
        );
    });

    it('purpose-overflow → submit-кнопка disabled', async () => {
        renderForm();
        const purposeTextarea = screen.getByPlaceholderText(/За замовчуванням/);
        const longPurpose = 'a'.repeat(500);
        await act(async () => {
            fireEvent.change(purposeTextarea, {
                target: { value: longPurpose },
            });
        });
        const submitBtn = screen.getByRole('button', {
            name: /Створити рахунок/,
        });
        expect(submitBtn).toBeDisabled();
    });
});
