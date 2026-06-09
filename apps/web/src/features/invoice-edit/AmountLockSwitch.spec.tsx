import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Invoice } from '@finly/types';
import { AmountLockSwitch } from './AmountSection';

const baseInvoice: Invoice = {
    id: '507f1f77bcf86cd799439021',
    businessId: '507f1f77bcf86cd799439011',
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

/**
 * Sprint 4 §4.6 — toggle блокування суми, винесений окремим рядком картки
 * «Дані платежу» (дзеркало SEO-тоглу business-сторінки). Заголовок-статус
 * описує поточний стан, опис пояснює, чим керує перемикач.
 */
describe('AmountLockSwitch (coupled SP-6 + status-title)', () => {
    it('amount=number → switch enabled', () => {
        render(<AmountLockSwitch invoice={baseInvoice} onSave={jest.fn()} />);
        expect(screen.getByRole('switch')).not.toBeDisabled();
    });

    it('amount=null → switch disabled (coupled rule SP-6 UI guard) + signage-title', () => {
        render(
            <AmountLockSwitch
                invoice={{ ...baseInvoice, amount: null, amountLocked: false }}
                onSave={jest.fn()}
            />
        );
        expect(screen.getByRole('switch')).toBeDisabled();
        expect(
            screen.getByText('Клієнт вписує суму у банку сам')
        ).toBeInTheDocument();
        expect(
            screen.getByText(/Доступно лише коли задано суму/)
        ).toBeInTheDocument();
    });

    it('amountLocked=true → status-title «Клієнт сплатить точно зазначену суму»', () => {
        render(<AmountLockSwitch invoice={baseInvoice} onSave={jest.fn()} />);
        expect(
            screen.getByText('Клієнт сплатить точно зазначену суму')
        ).toBeInTheDocument();
    });

    it('amountLocked=false → status-title «Клієнт може змінити суму перед оплатою»', () => {
        render(
            <AmountLockSwitch
                invoice={{ ...baseInvoice, amountLocked: false }}
                onSave={jest.fn()}
            />
        );
        expect(
            screen.getByText('Клієнт може змінити суму перед оплатою')
        ).toBeInTheDocument();
    });

    it('switch toggle → onSave({amountLocked: !allowEdit})', async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        render(<AmountLockSwitch invoice={baseInvoice} onSave={onSave} />);
        // locked=true → switch off; клік ⇒ allowEdit=true ⇒ amountLocked=false.
        fireEvent.click(screen.getByRole('switch'));
        await waitFor(() =>
            expect(onSave).toHaveBeenCalledWith({ amountLocked: false })
        );
    });

    /**
     * `handlePatch` re-throw-ає після toast-у, тож inline `void onSave(...)`
     * залишав би unhandled promise rejection. Перевіряємо, що toggle-handler
     * ловить rejection локально і повертає switch у interactive-state.
     */
    it('toggle save reject → no unhandled rejection, switch знову інтерактивний', async () => {
        const onSave = jest
            .fn()
            .mockRejectedValueOnce(new Error('Network error'));
        const unhandled = jest.fn();
        process.on('unhandledRejection', unhandled);
        try {
            render(
                <AmountLockSwitch invoice={baseInvoice} onSave={onSave} />
            );
            fireEvent.click(screen.getByRole('switch'));
            await waitFor(() =>
                expect(onSave).toHaveBeenCalledWith({ amountLocked: false })
            );
            await waitFor(() =>
                expect(screen.getByRole('switch')).not.toBeDisabled()
            );
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });

    it('toggle під час save → switch disabled (anti-spam)', async () => {
        let resolveOnSave: (() => void) | undefined;
        const onSave = jest.fn(
            () =>
                new Promise<void>((resolve) => {
                    resolveOnSave = resolve;
                })
        );
        render(<AmountLockSwitch invoice={baseInvoice} onSave={onSave} />);
        const lockSwitch = screen.getByRole('switch');
        fireEvent.click(lockSwitch);
        await waitFor(() => expect(lockSwitch).toBeDisabled());
        resolveOnSave?.();
        await waitFor(() => expect(lockSwitch).not.toBeDisabled());
    });
});
