import React from 'react';
import {
    render,
    screen,
    fireEvent,
    waitFor,
    act,
} from '@testing-library/react';
import type { Invoice } from '@finly/types';
import { formatKyivDate } from '@/shared/lib';
import ValidUntilSection from './ValidUntilSection';

/** UiSelect — кастомний trigger-button + options-popover (не нативний select). */
async function pickMode(label: RegExp) {
    const trigger = screen
        .getAllByRole('button')
        .find((b) => /Без терміну|До конкретної дати/.test(b.textContent ?? ''))!;
    await act(async () => {
        fireEvent.click(trigger);
    });
    const option = await screen.findByRole('option', { name: label });
    await act(async () => {
        fireEvent.click(option);
    });
}

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
 * Sprint 4 §4.6 — рядок «Термін дії». Badge «Прострочено» переїхав у хедер
 * `PaymentDetailsCard` (див. `PaymentDetailsCard.spec`), тут — read-mode +
 * ручний ввід дати у форматі `ДД.ММ.РРРР`.
 */
describe('ValidUntilSection (read-mode + ручний ввід дати)', () => {
    it('read-mode: validUntil=null показує "Без терміну"', () => {
        render(<ValidUntilSection invoice={baseInvoice} onSave={jest.fn()} />);
        expect(screen.getByText('Без терміну')).toBeInTheDocument();
    });

    it('read-mode: validUntil!=null показує форматовану дату (Kyiv-tz)', () => {
        const date = new Date('2026-12-31T23:59:59');
        render(
            <ValidUntilSection
                invoice={{ ...baseInvoice, validUntil: date }}
                onSave={jest.fn()}
            />
        );
        // Звіряємо тим самим Kyiv-tz форматером, що й компонент: інакше асерція
        // залежить від TZ раннера (UTC на CI зсуває дату біля півночі на добу).
        expect(screen.getByText(formatKyivDate(date))).toBeInTheDocument();
    });

    it('edit + ручний ввід дати → onSave з validUntil (23:59:59 Kyiv того дня)', async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        render(<ValidUntilSection invoice={baseInvoice} onSave={onSave} />);
        fireEvent.click(screen.getByLabelText('Редагувати: Термін дії'));
        await pickMode(/До конкретної дати/);
        const input = screen.getByLabelText('Дата у форматі ДД.ММ.РРРР');
        fireEvent.change(input, { target: { value: '15.08.2026' } });
        fireEvent.click(screen.getByText('Зберегти'));
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        const saved = onSave.mock.calls[0]![0].validUntil as Date;
        // 15.08.2026 23:59:59 Europe/Kyiv (літо UTC+3) = 20:59:59Z.
        expect(saved.toISOString()).toBe('2026-08-15T20:59:59.000Z');
    });

    it('невалідна дата → кнопка клікабельна, показує причину, onSave НЕ викликається', async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        render(<ValidUntilSection invoice={baseInvoice} onSave={onSave} />);
        fireEvent.click(screen.getByLabelText('Редагувати: Термін дії'));
        await pickMode(/До конкретної дати/);
        const input = screen.getByLabelText('Дата у форматі ДД.ММ.РРРР');
        // Неіснуюча дата — 31 лютого.
        fireEvent.change(input, { target: { value: '31.02.2026' } });
        const saveBtn = screen.getByText('Зберегти').closest('button');
        expect(saveBtn).not.toBeDisabled();
        fireEvent.click(screen.getByText('Зберегти'));
        await waitFor(() =>
            expect(
                screen.getByText(/Введіть дату у форматі ДД\.ММ\.РРРР/)
            ).toBeInTheDocument()
        );
        expect(onSave).not.toHaveBeenCalled();
    });

    it('режим "Без терміну" → onSave({ validUntil: null })', async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        const withDate = {
            ...baseInvoice,
            validUntil: new Date('2026-12-31T21:59:59.000Z'),
        };
        render(<ValidUntilSection invoice={withDate} onSave={onSave} />);
        fireEvent.click(screen.getByLabelText('Редагувати: Термін дії'));
        // Стартує у режимі date; перемикаємо на none.
        await pickMode(/Без терміну/);
        fireEvent.click(screen.getByText('Зберегти'));
        await waitFor(() =>
            expect(onSave).toHaveBeenCalledWith({ validUntil: null })
        );
    });
});
