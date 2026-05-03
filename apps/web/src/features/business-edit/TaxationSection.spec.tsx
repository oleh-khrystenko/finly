import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Business } from '@finly/types';
import TaxationSection from './TaxationSection';

const baseBusiness: Business = {
    id: '507f1f77bcf86cd799439011',
    type: 'fop',
    ownerId: '507f1f77bcf86cd799439012',
    managers: [],
    slug: 'IvanEnko',
    slugLower: 'ivanenko',
    name: 'Іваненко',
    requisites: { iban: 'UA213223130000026007233566001', taxId: '1234567899' },
    taxationSystem: 'simplified-3',
    isVatPayer: true,
    paymentPurposeTemplate: 'Оплата',
    acceptedBanks: ['privatbank'],
    seoIndexEnabled: false,
    deletedAt: null,
    createdAt: new Date('2026-05-01'),
    updatedAt: new Date('2026-05-01'),
};

describe('TaxationSection — coupled rule (Sprint 3 §C1)', () => {
    it('read mode показує taxationSystem label + isVatPayer "Так/Ні"', () => {
        render(<TaxationSection business={baseBusiness} onSave={jest.fn()} />);
        expect(screen.getByText('Спрощена-3')).toBeInTheDocument();
        expect(screen.getByText('Так')).toBeInTheDocument();
    });

    it('VAT switch checked + enabled з existing simplified-3 + isVatPayer=true', () => {
        render(<TaxationSection business={baseBusiness} onSave={jest.fn()} />);
        fireEvent.click(
            screen.getByLabelText('Редагувати: оподаткування'),
        );
        const vatSwitch = screen.getByRole('switch', {
            name: /платник пдв/i,
        });
        expect(vatSwitch).toHaveAttribute('aria-checked', 'true');
        expect(vatSwitch).not.toBeDisabled();
    });

    it('VAT switch disabled з existing simplified-1 (coupled-rule UI guard)', () => {
        const businessWithSimp1: Business = {
            ...baseBusiness,
            taxationSystem: 'simplified-1',
            isVatPayer: false,
        };
        render(
            <TaxationSection
                business={businessWithSimp1}
                onSave={jest.fn()}
            />,
        );
        fireEvent.click(
            screen.getByLabelText('Редагувати: оподаткування'),
        );
        const vatSwitch = screen.getByRole('switch', {
            name: /платник пдв/i,
        });
        expect(vatSwitch).toBeDisabled();
        expect(
            screen.getByText(
                /пдв доступний для спрощеної-3 і загальної/i,
            ),
        ).toBeInTheDocument();
    });

    it('Save: викликає onSave з обома полями за один PATCH', async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        render(<TaxationSection business={baseBusiness} onSave={onSave} />);

        fireEvent.click(
            screen.getByLabelText('Редагувати: оподаткування'),
        );
        fireEvent.click(screen.getByText('Зберегти'));
        await Promise.resolve();

        expect(onSave).toHaveBeenCalledWith({
            taxationSystem: 'simplified-3',
            isVatPayer: true,
        });
    });
});
