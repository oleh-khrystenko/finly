import React from 'react';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import type { Business, Invoice } from '@finly/types';

const mockCreateInvoice = jest.fn();
const mockReplace = jest.fn();
const mockOpenWarning = jest.fn();
const mockCancelWarning = jest.fn();

jest.mock('@/shared/api', () => ({
    createInvoice: (...args: unknown[]) => mockCreateInvoice(...args),
    getApiMessage: jest.fn((code: string) => `[${code}]`),
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('@/entities/invoice', () => ({
    useSlugPresetWarningStore: (
        selector: (state: {
            open: typeof mockOpenWarning;
        }) => unknown,
    ) =>
        selector({
            open: mockOpenWarning,
        }),
}));

import CreateInvoiceForm from './CreateInvoiceForm';

const VALID_IBAN = 'UA213223130000026007233566001';
const VALID_TAX_ID = '1234567899';

const baseBusiness: Business = {
    id: '507f1f77bcf86cd799439011',
    type: 'fop',
    ownerId: '507f1f77bcf86cd799439012',
    managers: [],
    slug: 'IvanEnko',
    slugLower: 'ivanenko',
    name: 'ФОП Іваненко',
    requisites: { iban: VALID_IBAN, taxId: VALID_TAX_ID },
    taxationSystem: 'simplified-3',
    isVatPayer: false,
    paymentPurposeTemplate: 'Оплата за послуги',
    acceptedBanks: ['privatbank'],
    seoIndexEnabled: false,
    invoiceSlugPresetDefault: null,
    deletedAt: null,
    createdAt: new Date('2026-05-01T10:00:00Z'),
    updatedAt: new Date('2026-05-01T10:00:00Z'),
};

const ROBUST_INVOICE: Invoice = {
    id: '507f1f77bcf86cd799439021',
    businessId: baseBusiness.id,
    slug: 'inv-001-aB3xQ9k7',
    amount: null,
    amountLocked: false,
    paymentPurpose: null,
    validUntil: null,
    slugPreset: 'simple',
    slugCounterScope: 'simple',
    slugCounter: 1,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
};

beforeEach(() => {
    mockCreateInvoice.mockReset();
    mockReplace.mockReset();
    mockOpenWarning.mockReset();
    mockCancelWarning.mockReset();
    mockCreateInvoice.mockResolvedValue(ROBUST_INVOICE);
});

/**
 * Sprint 4 §4.5 DoD: усі 6 dropdown-опцій (explicit + 4 пресети + random)
 * дають valid POST з правильним `slugInput.kind` discriminator-ом.
 */
describe('CreateInvoiceForm — slugInput happy paths (Sprint 4 §4.5 DoD a/b/c/d)', () => {
    /**
     * Helper: знаходимо select-button за поточним label-ом всередині dropdown-у.
     * UiSelect рендериться через Headless Listbox — кожен button має
     * `data-variant`/`data-size`, але стабільніше шукати за role + name.
     */
    async function selectSlugOption(label: RegExp | string): Promise<void> {
        const triggers = screen.getAllByRole('button');
        // Перший button — "Як назвати рахунок"; точніше — той, що має SLUG_OPTIONS-label.
        const slugTrigger = triggers.find((b) =>
            /Автоматично|Ввести самому|Випадковий код/.test(
                b.textContent ?? '',
            ),
        );
        if (!slugTrigger) throw new Error('slug dropdown not found');
        await act(async () => {
            fireEvent.click(slugTrigger);
        });
        // Розкритий listbox — шукаємо потрібну опцію.
        const option = await screen.findByRole('option', { name: label });
        await act(async () => {
            fireEvent.click(option);
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

    it('default: kind="preset", preset="simple" коли invoiceSlugPresetDefault=null', async () => {
        render(<CreateInvoiceForm business={baseBusiness} />);
        await clickSubmit();
        await waitFor(() => expect(mockCreateInvoice).toHaveBeenCalled());

        const [businessSlug, payload] = mockCreateInvoice.mock.calls[0]!;
        expect(businessSlug).toBe('IvanEnko');
        expect(payload.slugInput).toEqual({
            kind: 'preset',
            preset: 'simple',
        });
    });

    it('default mount = "with-month" коли invoiceSlugPresetDefault="with-month" (DoD б)', async () => {
        render(
            <CreateInvoiceForm
                business={{
                    ...baseBusiness,
                    invoiceSlugPresetDefault: 'with-month',
                }}
            />,
        );
        await clickSubmit();
        await waitFor(() => expect(mockCreateInvoice).toHaveBeenCalled());
        expect(mockCreateInvoice.mock.calls[0]![1].slugInput).toEqual({
            kind: 'preset',
            preset: 'with-month',
        });
    });

    it('default mount = "with-purpose" БЕЗ автоматичного warning-modal (DoD в — edge-case)', async () => {
        render(
            <CreateInvoiceForm
                business={{
                    ...baseBusiness,
                    invoiceSlugPresetDefault: 'with-purpose',
                    paymentPurposeTemplate: 'Послуги',
                }}
            />,
        );
        // Жодного автоматичного warning не тригериться на mount.
        expect(mockOpenWarning).not.toHaveBeenCalled();

        await clickSubmit();
        await waitFor(() => expect(mockCreateInvoice).toHaveBeenCalled());
        expect(mockCreateInvoice.mock.calls[0]![1].slugInput).toEqual({
            kind: 'preset',
            preset: 'with-purpose',
        });
    });

    it.each([
        [/простий номер/, { kind: 'preset', preset: 'simple' }],
        [/з місяцем/, { kind: 'preset', preset: 'with-month' }],
        [/з роком/, { kind: 'preset', preset: 'with-year' }],
        [/Випадковий код/, { kind: 'random' }],
    ] as const)(
        'manual select "%s" → POST.slugInput shape correct',
        async (label, expected) => {
            render(<CreateInvoiceForm business={baseBusiness} />);
            await selectSlugOption(label);
            await clickSubmit();
            await waitFor(() =>
                expect(mockCreateInvoice).toHaveBeenCalled(),
            );
            expect(mockCreateInvoice.mock.calls[0]![1].slugInput).toEqual(
                expected,
            );
        },
    );

    it('"Ввести самому" + valid humanPart → POST {kind:"explicit", humanPart}', async () => {
        render(<CreateInvoiceForm business={baseBusiness} />);
        await selectSlugOption(/Ввести самому/);
        const input = await screen.findByPlaceholderText(
            /order-2026-may/,
        );
        await act(async () => {
            fireEvent.change(input, {
                target: { value: 'order-2026-may' },
            });
        });
        await clickSubmit();
        await waitFor(() => expect(mockCreateInvoice).toHaveBeenCalled());
        expect(mockCreateInvoice.mock.calls[0]![1].slugInput).toEqual({
            kind: 'explicit',
            humanPart: 'order-2026-may',
        });
    });
});

/**
 * Sprint 4 §4.5 DoD: humanSlugPartSchema live-validation — invalid input
 * (uppercase, дефіс на краях, послідовні дефіси, > 60 chars) → submit blocked.
 */
describe('CreateInvoiceForm — humanPart live-validation', () => {
    async function chooseExplicit(): Promise<HTMLElement> {
        render(<CreateInvoiceForm business={baseBusiness} />);
        // Open dropdown
        const triggers = screen.getAllByRole('button');
        const slugTrigger = triggers.find((b) =>
            /Автоматично|Ввести самому|Випадковий код/.test(
                b.textContent ?? '',
            ),
        )!;
        await act(async () => {
            fireEvent.click(slugTrigger);
        });
        const option = await screen.findByRole('option', {
            name: /Ввести самому/,
        });
        await act(async () => {
            fireEvent.click(option);
        });
        return screen.findByPlaceholderText(/order-2026-may/);
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
                    }),
                );
            });
            // Submit заблокований — createInvoice не викликається.
            expect(mockCreateInvoice).not.toHaveBeenCalled();
        },
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
                }),
            );
        });
        await waitFor(() => expect(mockCreateInvoice).toHaveBeenCalled());
    });
});

/**
 * Sprint 4 §4.5 DoD: Coupled `amount=null + amountLocked` UI lock (SP-6).
 */
describe('CreateInvoiceForm — coupled amount × amountLocked (SP-6)', () => {
    it('amount=null → switch disabled, аria-checked=true (allowEdit-display force-ON у signage)', () => {
        render(<CreateInvoiceForm business={baseBusiness} />);
        const lockSwitch = document.getElementById('amount-lock-switch')!;
        expect(lockSwitch).toBeDisabled();
        // SP-6 — у signage UI завжди показує allow-edit ON (бо без суми
        // клієнт de-facto завжди вводить її сам). Submit-normalizer теж
        // перетворить wire-shape на amountLocked=false для signage.
        expect(lockSwitch).toHaveAttribute('aria-checked', 'true');
    });

    it('amount=number → switch enabled, default aria-checked=false (locked за SP-6)', async () => {
        render(<CreateInvoiceForm business={baseBusiness} />);
        const amountInput = screen.getByPlaceholderText('1500,50');
        await act(async () => {
            fireEvent.change(amountInput, { target: { value: '1500' } });
        });
        const lockSwitch = document.getElementById('amount-lock-switch')!;
        expect(lockSwitch).not.toBeDisabled();
        // SP-6 default: amountLocked=true ⇒ allow-edit OFF ⇒ aria-checked=false.
        // Це "швидкий шлях" фіксованої суми (як у класичному інвойсі).
        expect(lockSwitch).toHaveAttribute('aria-checked', 'false');
    });

    it('UA-кома приймається: 1500,50 → switch enabled, default locked', async () => {
        render(<CreateInvoiceForm business={baseBusiness} />);
        const amountInput = screen.getByPlaceholderText('1500,50');
        await act(async () => {
            fireEvent.change(amountInput, { target: { value: '1500,50' } });
        });
        const lockSwitch = document.getElementById('amount-lock-switch')!;
        expect(lockSwitch).not.toBeDisabled();
        expect(lockSwitch).toHaveAttribute('aria-checked', 'false');
    });

    /**
     * Sprint 4 review fix — критичний регресійний тест:
     * **Transient parse-error НЕ повинен скидати `amountLocked`.**
     *
     * Раніше `parsedAmount === null` мав подвійний сенс (signage АБО invalid),
     * тож useEffect SP-6 reset-ив amountLocked при будь-якому невалідному
     * вводі під час набору. Сценарій: ФОП ввів 1500 → toggle "Дозволити
     * правити" ON (amountLocked=false) → виправляє суму на 1500,50, але між
     * цим transient input "1500,abc" парсився як invalid → reset state →
     * submit ішов з не тим intent-ом, попри початковий намір ФОПа.
     */
    it('transient invalid input → amountLocked НЕ скидається', async () => {
        render(<CreateInvoiceForm business={baseBusiness} />);
        const amountInput = screen.getByPlaceholderText('1500,50');
        const lockSwitch = document.getElementById('amount-lock-switch')!;

        // 1. Ввести валідну суму. Default — locked (aria-checked=false).
        await act(async () => {
            fireEvent.change(amountInput, { target: { value: '1500' } });
        });
        expect(lockSwitch).not.toBeDisabled();
        expect(lockSwitch).toHaveAttribute('aria-checked', 'false');

        // 2. Toggle на "Дозволити правити" ON (allowEdit=true ⇒ amountLocked=false).
        await act(async () => {
            fireEvent.click(lockSwitch);
        });
        expect(lockSwitch).toHaveAttribute('aria-checked', 'true');

        // 3. Введемо transient invalid input.
        await act(async () => {
            fireEvent.change(amountInput, { target: { value: '1500abc' } });
        });

        // 4. Перевірка: stored intent НЕ скинувся. Switch стає disabled
        //    (transient invalid), але aria-checked відображає stored=true.
        expect(lockSwitch).toBeDisabled();
        expect(lockSwitch).toHaveAttribute('aria-checked', 'true');

        // 5. Виправимо ввід — switch знову enabled і intent intact.
        await act(async () => {
            fireEvent.change(amountInput, { target: { value: '1500,50' } });
        });
        expect(lockSwitch).not.toBeDisabled();
        expect(lockSwitch).toHaveAttribute('aria-checked', 'true');
    });

    /**
     * Sanity-counterpart: signage-mode (parse-ok, empty input) **візуально**
     * показує allow-edit ON, але stored intent зберігається — повернення до
     * валідної суми відновлює попередній user-toggle. Це SP-6 + win над
     * raw `useEffect`-reset, що губив намір ФОПа.
     */
    it('semantic signage → візуально ON, stored intent зберігається', async () => {
        render(<CreateInvoiceForm business={baseBusiness} />);
        const amountInput = screen.getByPlaceholderText('1500,50');
        const lockSwitch = document.getElementById('amount-lock-switch')!;

        // Ввели суму — default locked (aria-checked=false).
        await act(async () => {
            fireEvent.change(amountInput, { target: { value: '1500' } });
        });
        expect(lockSwitch).toHaveAttribute('aria-checked', 'false');

        // Очистили input — справжній signage. UI force-показує ON.
        await act(async () => {
            fireEvent.change(amountInput, { target: { value: '' } });
        });
        await waitFor(() => {
            expect(lockSwitch).toHaveAttribute('aria-checked', 'true');
        });
        expect(lockSwitch).toBeDisabled();

        // Повернення до has-amount → stored intent (locked) знову видимий.
        await act(async () => {
            fireEvent.change(amountInput, { target: { value: '2000' } });
        });
        expect(lockSwitch).not.toBeDisabled();
        expect(lockSwitch).toHaveAttribute('aria-checked', 'false');
    });
});

/**
 * Sprint 4 §4.5 DoD: with-purpose warning-modal flow (показ при першому
 * виборі через dropdown; не показ на page-load default).
 */
describe('CreateInvoiceForm — with-purpose warning modal', () => {
    it('manual select preset:with-purpose → openWarning викликається', async () => {
        render(<CreateInvoiceForm business={baseBusiness} />);
        const triggers = screen.getAllByRole('button');
        const slugTrigger = triggers.find((b) =>
            /Автоматично|Ввести самому|Випадковий код/.test(
                b.textContent ?? '',
            ),
        )!;
        await act(async () => {
            fireEvent.click(slugTrigger);
        });
        const option = await screen.findByRole('option', {
            name: /з призначення/,
        });
        await act(async () => {
            fireEvent.click(option);
        });
        expect(mockOpenWarning).toHaveBeenCalledTimes(1);
        // Перший аргумент — onConfirm callback; другий — onCancel.
        expect(typeof mockOpenWarning.mock.calls[0]![0]).toBe('function');
        expect(typeof mockOpenWarning.mock.calls[0]![1]).toBe('function');
    });

    it('mount з business.invoiceSlugPresetDefault="with-purpose" → openWarning НЕ викликається (page-load)', () => {
        render(
            <CreateInvoiceForm
                business={{
                    ...baseBusiness,
                    invoiceSlugPresetDefault: 'with-purpose',
                }}
            />,
        );
        expect(mockOpenWarning).not.toHaveBeenCalled();
    });
});

/**
 * Sprint 4 §4.5 DoD: required-fields validation. Тут тестуємо submit-blocking
 * edge-case: validUntilMode='date' з порожньою датою → submit blocked.
 */
describe('CreateInvoiceForm — required-fields validation', () => {
    it('validUntilMode="date" + empty date → submit blocked', async () => {
        render(<CreateInvoiceForm business={baseBusiness} />);
        // Знаходимо dropdown "Термін дії"
        const triggers = screen.getAllByRole('button');
        const validUntilTrigger = triggers.find((b) =>
            /Без терміну|До конкретної дати/.test(b.textContent ?? ''),
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
        // Дату не заповнюємо. Submit має блокуватись.
        await act(async () => {
            fireEvent.click(
                screen.getByRole('button', {
                    name: /Створити рахунок/,
                }),
            );
        });
        expect(mockCreateInvoice).not.toHaveBeenCalled();
        expect(await screen.findByText(/Оберіть дату/)).toBeInTheDocument();
    });

    it('purpose-overflow → submit-кнопка disabled', async () => {
        render(<CreateInvoiceForm business={baseBusiness} />);
        const purposeTextarea = screen.getByPlaceholderText(/Якщо порожньо/);
        const longPurpose = 'a'.repeat(500); // > 420 chars
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
