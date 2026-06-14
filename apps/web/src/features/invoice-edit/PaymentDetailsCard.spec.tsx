import React from 'react';
import { render, screen } from '@testing-library/react';
import type { Business, Invoice } from '@finly/types';
import PaymentDetailsCard from './PaymentDetailsCard';

const baseBusiness: Business = {
    id: '507f1f77bcf86cd799439011',
    type: 'fop',
    ownerId: '507f1f77bcf86cd799439012',
    managers: [],
    slug: 'IvanEnko',
    slugLower: 'ivanenko',
    name: 'ФОП Іваненко',
    taxId: '1234567890',
    taxationSystem: 'simplified-3',
    isVatPayer: false,
    paymentPurposeTemplate: 'Оплата за послуги',
    seoIndexEnabled: false,
    deletedAt: null,
    accessBlockedAt: null,
    createdAt: new Date('2026-05-01T10:00:00Z'),
    updatedAt: new Date('2026-05-01T10:00:00Z'),
};

const baseInvoice: Invoice = {
    id: '507f1f77bcf86cd799439021',
    businessId: baseBusiness.id,
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
 * Sprint 4 §4.6 — інваріант expired-badge живе у хедері merged-картки
 * «Дані платежу» (раніше — у рядку «Термін дії»), щоб статус читався на рівні
 * всього блоку. Тест переїхав сюди з `ValidUntilSection.spec` разом з бейджем.
 */
describe('PaymentDetailsCard (expired-badge у хедері картки)', () => {
    it('validUntil=null → no badge (active state)', () => {
        render(
            <PaymentDetailsCard
                invoice={baseInvoice}
                business={baseBusiness}
                onSave={jest.fn()}
            />
        );
        expect(screen.queryByText('Прострочено')).not.toBeInTheDocument();
    });

    it('validUntil у майбутньому → no badge (active)', () => {
        const future = new Date();
        future.setFullYear(future.getFullYear() + 1);
        render(
            <PaymentDetailsCard
                invoice={{ ...baseInvoice, validUntil: future }}
                business={baseBusiness}
                onSave={jest.fn()}
            />
        );
        expect(screen.queryByText('Прострочено')).not.toBeInTheDocument();
    });

    it('validUntil у минулому → "Прострочено" badge видимий (DoD §4.6)', () => {
        render(
            <PaymentDetailsCard
                invoice={{ ...baseInvoice, validUntil: new Date('2024-01-01') }}
                business={baseBusiness}
                onSave={jest.fn()}
            />
        );
        expect(screen.getByText('Прострочено')).toBeInTheDocument();
    });

    it('картка має заголовок «Дані платежу»', () => {
        render(
            <PaymentDetailsCard
                invoice={baseInvoice}
                business={baseBusiness}
                onSave={jest.fn()}
            />
        );
        expect(screen.getByText('Дані платежу')).toBeInTheDocument();
    });
});
