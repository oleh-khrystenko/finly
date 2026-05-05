import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Invoice } from '@finly/types';
import AmountSection from './AmountSection';

const baseInvoice: Invoice = {
    id: '507f1f77bcf86cd799439021',
    businessId: '507f1f77bcf86cd799439011',
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

describe('AmountSection (Sprint 4 §4.6 — coupled SP-6)', () => {
    it('amount=number → switch enabled (allow-edit OFF, locked=true)', () => {
        render(<AmountSection invoice={baseInvoice} onSave={jest.fn()} />);
        expect(screen.getByRole('switch')).not.toBeDisabled();
    });

    it('amount=null → switch disabled (coupled rule SP-6 UI guard)', () => {
        render(
            <AmountSection
                invoice={{ ...baseInvoice, amount: null, amountLocked: false }}
                onSave={jest.fn()}
            />,
        );
        const lockSwitch = screen.getByRole('switch');
        expect(lockSwitch).toBeDisabled();
    });

    it('amount=null → label показує coupled-rule hint', () => {
        render(
            <AmountSection
                invoice={{ ...baseInvoice, amount: null, amountLocked: false }}
                onSave={jest.fn()}
            />,
        );
        expect(
            screen.getByText(/Заблокувати можна лише при заданій сумі/),
        ).toBeInTheDocument();
    });

    it('amount=number + amountLocked=true → label показує lock-hint', () => {
        render(<AmountSection invoice={baseInvoice} onSave={jest.fn()} />);
        expect(
            screen.getByText(
                /Якщо вимкнено — клієнт сплатить точно зазначену суму/,
            ),
        ).toBeInTheDocument();
    });

    it('switch toggle → onSave({amountLocked: !next})', async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        render(<AmountSection invoice={baseInvoice} onSave={onSave} />);
        const lockSwitch = screen.getByRole('switch');
        fireEvent.click(lockSwitch);
        await waitFor(() =>
            expect(onSave).toHaveBeenCalledWith({ amountLocked: false }),
        );
    });

    it('amount-edit save → onSave({amount: kopecks})', async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        render(<AmountSection invoice={baseInvoice} onSave={onSave} />);
        // Open edit-mode — клік на "Олівець"-edit button.
        fireEvent.click(screen.getByLabelText(/Редагувати: Сума/));
        const input = screen.getByPlaceholderText(/1500.00/);
        fireEvent.change(input, { target: { value: '2500' } });
        fireEvent.click(screen.getByText('Зберегти'));
        await waitFor(() =>
            expect(onSave).toHaveBeenCalledWith({ amount: 250000 }),
        );
    });

    it('amount=number → null edit → also resets amountLocked=false (auto-unlock)', async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        render(<AmountSection invoice={baseInvoice} onSave={onSave} />);
        fireEvent.click(screen.getByLabelText(/Редагувати: Сума/));
        const input = screen.getByPlaceholderText(/1500.00/);
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.click(screen.getByText('Зберегти'));
        await waitFor(() =>
            expect(onSave).toHaveBeenCalledWith({
                amount: null,
                amountLocked: false,
            }),
        );
    });
});
