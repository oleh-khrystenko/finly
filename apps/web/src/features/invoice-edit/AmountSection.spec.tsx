import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Invoice } from '@finly/types';
import AmountSection from './AmountSection';

const baseInvoice: Invoice = {
    id: '507f1f77bcf86cd799439021',
    businessId: '507f1f77bcf86cd799439011',
    // Sprint 9 — invoice nested під account (compound-unique scope `(accountId, slug)`).
    accountId: '507f1f77bcf86cd799439055',
    slug: 'inv-001-aB3xQ9k7',
    slugLower: 'inv-001-ab3xq9k7',
    amount: 150000,
    amountLocked: true,
    paymentPurpose: 'Оплата',
    validUntil: null,
    slugPreset: 'simple',
    slugCounterScope: 'simple',
    slugCounter: 1,
    payeeSnapshot: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
};

describe('AmountSection (Sprint 4 §4.6 — money-field; lock-switch → AmountLockSwitch.spec)', () => {
    it('amount-edit save → onSave({amount: kopecks})', async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        render(<AmountSection invoice={baseInvoice} onSave={onSave} />);
        // Open edit-mode — клік на "Олівець"-edit button.
        fireEvent.click(screen.getByLabelText(/Редагувати: Сума/));
        const input = screen.getByPlaceholderText(/1500,50/);
        fireEvent.change(input, { target: { value: '2500' } });
        fireEvent.click(screen.getByText('Зберегти'));
        await waitFor(() =>
            expect(onSave).toHaveBeenCalledWith({ amount: 250000 })
        );
    });

    it('amount=number → null edit → also resets amountLocked=false (auto-unlock)', async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        render(<AmountSection invoice={baseInvoice} onSave={onSave} />);
        fireEvent.click(screen.getByLabelText(/Редагувати: Сума/));
        const input = screen.getByPlaceholderText(/1500,50/);
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.click(screen.getByText('Зберегти'));
        await waitFor(() =>
            expect(onSave).toHaveBeenCalledWith({
                amount: null,
                amountLocked: false,
            })
        );
    });

    /**
     * Sprint 4 review fix — критичний регресійний тест: invalid input повинен
     * блокувати save повністю (не зберігати stale-amount, не закривати
     * edit-mode). Раніше click "Зберегти" з невалідним вводом silent-зберігав
     * попередній валідний amount + показував success-toast — payment-
     * correctness ризик.
     */
    it('невалідна сума → save заблокований, onSave НЕ викликається', async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        render(<AmountSection invoice={baseInvoice} onSave={onSave} />);
        fireEvent.click(screen.getByLabelText(/Редагувати: Сума/));
        const input = screen.getByPlaceholderText(/1500,50/);
        // Letters — INVALID_AMOUNT_FORMAT.
        fireEvent.change(input, { target: { value: '1500abc' } });
        fireEvent.click(screen.getByText('Зберегти'));

        // onSave не викликається.
        await waitFor(() => {
            expect(onSave).not.toHaveBeenCalled();
        });
        // Edit-mode залишається відкритим (Зберегти/Скасувати ще видні).
        expect(screen.getByText('Зберегти')).toBeInTheDocument();
        expect(screen.getByText('Скасувати')).toBeInTheDocument();
    });

    it('невалідна сума → кнопка клікабельна, показує причину під полем', async () => {
        render(<AmountSection invoice={baseInvoice} onSave={jest.fn()} />);
        fireEvent.click(screen.getByLabelText(/Редагувати: Сума/));
        const input = screen.getByPlaceholderText(/1500,50/);
        fireEvent.change(input, { target: { value: '-100' } });
        // Кнопка не гасне — причина видима під полем (live).
        const saveBtn = screen.getByText('Зберегти').closest('button');
        expect(saveBtn).not.toBeDisabled();
        expect(
            screen.getByText(/Сума не може бути від.ємною/)
        ).toBeInTheDocument();
    });

    it('UA-кома приймається: 1500,50 → save 150050 копійок', async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        render(<AmountSection invoice={baseInvoice} onSave={onSave} />);
        fireEvent.click(screen.getByLabelText(/Редагувати: Сума/));
        const input = screen.getByPlaceholderText(/1500,50/);
        fireEvent.change(input, { target: { value: '1500,50' } });
        fireEvent.click(screen.getByText('Зберегти'));
        await waitFor(() =>
            expect(onSave).toHaveBeenCalledWith({ amount: 150050 })
        );
    });

    it('cancel у edit-mode → parseErr скидається на наступному edit', async () => {
        render(<AmountSection invoice={baseInvoice} onSave={jest.fn()} />);
        fireEvent.click(screen.getByLabelText(/Редагувати: Сума/));
        const input = screen.getByPlaceholderText(/1500,50/);
        // Введемо невалідне.
        fireEvent.change(input, { target: { value: 'abc' } });
        // Cancel.
        fireEvent.click(screen.getByText('Скасувати'));
        // Re-open edit — input повертається до formatted value, parseErr null.
        fireEvent.click(screen.getByLabelText(/Редагувати: Сума/));
        const reopened = screen.getByPlaceholderText(/1500,50/);
        // Reopen-state: значення з invoice.amount = 150000 → "1500,00".
        expect((reopened as HTMLInputElement).value).toBe('1500,00');
        // parseErr скинуто після reset — причини під полем більше немає.
        expect(screen.queryByText(/Введіть число/)).not.toBeInTheDocument();
    });
});
