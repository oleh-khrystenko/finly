import React from 'react';
import { render, screen } from '@testing-library/react';
import type { Invoice } from '@finly/types';
import ValidUntilSection from './ValidUntilSection';

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

describe('ValidUntilSection (Sprint 4 §4.6 — expired-badge invariant)', () => {
    it('validUntil=null → no badge (active state)', () => {
        render(<ValidUntilSection invoice={baseInvoice} onSave={jest.fn()} />);
        expect(screen.queryByText('Прострочено')).not.toBeInTheDocument();
    });

    it('validUntil у майбутньому → no badge (active)', () => {
        const future = new Date();
        future.setFullYear(future.getFullYear() + 1);
        render(
            <ValidUntilSection
                invoice={{ ...baseInvoice, validUntil: future }}
                onSave={jest.fn()}
            />
        );
        expect(screen.queryByText('Прострочено')).not.toBeInTheDocument();
    });

    it('validUntil у минулому → "Прострочено" badge видимий (DoD §4.6)', () => {
        const past = new Date('2024-01-01');
        render(
            <ValidUntilSection
                invoice={{ ...baseInvoice, validUntil: past }}
                onSave={jest.fn()}
            />
        );
        expect(screen.getByText('Прострочено')).toBeInTheDocument();
    });

    it('read-mode: validUntil=null показує "Без терміну"', () => {
        render(<ValidUntilSection invoice={baseInvoice} onSave={jest.fn()} />);
        expect(screen.getByText('Без терміну')).toBeInTheDocument();
    });

    it('read-mode: validUntil!=null показує форматовану дату (uk-UA locale)', () => {
        const date = new Date('2026-12-31T23:59:59');
        render(
            <ValidUntilSection
                invoice={{ ...baseInvoice, validUntil: date }}
                onSave={jest.fn()}
            />
        );
        // uk-UA дата формат — 31.12.2026 (як toLocaleDateString-output).
        expect(
            screen.getByText(date.toLocaleDateString('uk-UA'))
        ).toBeInTheDocument();
    });
});
