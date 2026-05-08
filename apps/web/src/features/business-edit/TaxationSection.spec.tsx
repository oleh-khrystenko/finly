import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TaxationSection, {
    type TaxationCapableBusiness,
} from './TaxationSection';

// Sprint 7 §7.8 — фікстура використовує `TaxationCapableBusiness` (intersection
// `Business & { taxationSystem: TaxationSystem; isVatPayer: boolean }`), бо
// саме цей narrow-тип очікує `TaxationSection.Props`. Parent у production
// гарантує цю форму через `hasTaxationFields`-type-guard перед рендером.
const baseBusiness: TaxationCapableBusiness = {
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
    invoiceSlugPresetDefault: null,
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
        const businessWithSimp1: TaxationCapableBusiness = {
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

    it('coupled flip: simplified-3 → simplified-1 миттєво ставить isVatPayer=false (Sprint 3 §3.8 DoD)', async () => {
        // Sprint plan §3.8 DoD дослівно: "зміна `simplified-3 → simplified-1`
        // миттєво ставить `isVatPayer=false`". Це UI-guard, що не дозволяє
        // submit невалідну coupled-пару (повторює C1 invariant з backend).
        const onSave = jest.fn().mockResolvedValue(undefined);
        render(<TaxationSection business={baseBusiness} onSave={onSave} />);

        fireEvent.click(
            screen.getByLabelText('Редагувати: оподаткування'),
        );

        // VAT switch checked + enabled (existing simplified-3 + isVatPayer=true)
        const vatSwitch = screen.getByRole('switch', {
            name: /платник пдв/i,
        });
        expect(vatSwitch).toHaveAttribute('aria-checked', 'true');
        expect(vatSwitch).not.toBeDisabled();

        // Open Headless UI Listbox + select 'Спрощена-1'.
        const taxationButton = screen.getByRole('button', {
            name: /спрощена-3/i,
        });
        fireEvent.click(taxationButton);
        const simp1Option = await screen.findByRole('option', {
            name: /спрощена-1/i,
        });
        fireEvent.click(simp1Option);

        // Coupled-flip: VAT auto-flipped to false + disabled (UI guard).
        await waitFor(() => {
            expect(vatSwitch).toHaveAttribute('aria-checked', 'false');
            expect(vatSwitch).toBeDisabled();
        });

        // Save → onSave з coupled-валідною парою (isVatPayer=false для simplified-1).
        fireEvent.click(screen.getByText('Зберегти'));
        await waitFor(() =>
            expect(onSave).toHaveBeenCalledWith({
                taxationSystem: 'simplified-1',
                isVatPayer: false,
            }),
        );
    });
});
