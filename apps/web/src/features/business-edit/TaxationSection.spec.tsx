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
    taxId: '1234567899',
    taxationSystem: 'simplified-3',
    isVatPayer: true,
    paymentPurposeTemplate: 'Оплата',
    seoIndexEnabled: false,
    deletedAt: null,
    brandedAt: null,
    brand: null,
    createdAt: new Date('2026-05-01'),
    updatedAt: new Date('2026-05-01'),
};

describe('TaxationSection — coupled rule (Sprint 3 §C1 + Sprint 13 VAT-cards)', () => {
    it('read mode показує taxationSystem label + natural-language VAT title (той самий, що у edit-картках)', () => {
        render(<TaxationSection business={baseBusiness} onSave={jest.fn()} />);
        expect(screen.getByText('Спрощена-3')).toBeInTheDocument();
        // simplified-3 + isVatPayer=true → "Ставка 3% + ПДВ" (з getVatChoiceOptions)
        expect(screen.getByText('Ставка 3% + ПДВ')).toBeInTheDocument();
    });

    it('edit з existing simplified-3 + isVatPayer=true → картка "Ставка 3% + ПДВ" обрана', () => {
        render(<TaxationSection business={baseBusiness} onSave={jest.fn()} />);
        fireEvent.click(screen.getByLabelText('Редагувати: оподаткування'));

        const vatYes = screen.getByRole('radio', {
            name: /ставка 3% \+ ПДВ/i,
        });
        expect(vatYes).toHaveAttribute('aria-checked', 'true');

        const vatNo = screen.getByRole('radio', {
            name: /ставка 5% без ПДВ/i,
        });
        expect(vatNo).toHaveAttribute('aria-checked', 'false');
    });

    it('edit з existing simplified-1 — VAT radio-cards секція прихована (юр-обмеження)', () => {
        const businessWithSimp1: TaxationCapableBusiness = {
            ...baseBusiness,
            taxationSystem: 'simplified-1',
            isVatPayer: false,
        };
        render(
            <TaxationSection business={businessWithSimp1} onSave={jest.fn()} />
        );
        fireEvent.click(screen.getByLabelText('Редагувати: оподаткування'));

        // На Спрощеній-1 ПДВ заборонений (ст. 293.3 ПКУ) — секція не рендериться.
        expect(
            screen.queryByRole('radio', { name: /ставка/i })
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole('radio', { name: /зареєстрований/i })
        ).not.toBeInTheDocument();
    });

    it('edit з existing Загальна → картки "Зареєстрований / Не зареєстрований"', () => {
        const generalBusiness: TaxationCapableBusiness = {
            ...baseBusiness,
            taxationSystem: 'general',
            isVatPayer: true,
        };
        render(
            <TaxationSection business={generalBusiness} onSave={jest.fn()} />
        );
        fireEvent.click(screen.getByLabelText('Редагувати: оподаткування'));

        // Інший набір карток — Загальна оперує фактом реєстрації, не ставкою.
        expect(
            screen.getByRole('radio', { name: /^Зареєстрований платник ПДВ/i })
        ).toHaveAttribute('aria-checked', 'true');
        expect(
            screen.getByRole('radio', { name: /^Не зареєстрований/i })
        ).toHaveAttribute('aria-checked', 'false');
    });

    it('Save: викликає onSave з обома полями за один PATCH', async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        render(<TaxationSection business={baseBusiness} onSave={onSave} />);

        fireEvent.click(screen.getByLabelText('Редагувати: оподаткування'));
        fireEvent.click(screen.getByText('Зберегти'));
        await Promise.resolve();

        expect(onSave).toHaveBeenCalledWith({
            taxationSystem: 'simplified-3',
            isVatPayer: true,
        });
    });

    it('ТОВ: dropdown містить лише simplified-3 і general (ПКУ розд. XIV — групи 1/2 заборонені для юр.осіб)', async () => {
        const tovBusiness: TaxationCapableBusiness = {
            ...baseBusiness,
            type: 'tov',
            taxId: '12345678',
            taxationSystem: 'simplified-3',
            isVatPayer: true,
        };
        render(<TaxationSection business={tovBusiness} onSave={jest.fn()} />);
        fireEvent.click(screen.getByLabelText('Редагувати: оподаткування'));

        // Headless UI Listbox: відкриваємо select клацанням на trigger.
        fireEvent.click(screen.getByRole('button', { name: /спрощена-3/i }));

        const options = await screen.findAllByRole('option');
        const optionLabels = options.map((o) => o.textContent ?? '');
        expect(optionLabels).toEqual(
            expect.arrayContaining(['Спрощена-3', 'Загальна'])
        );
        expect(optionLabels).not.toEqual(
            expect.arrayContaining(['Спрощена-1'])
        );
        expect(optionLabels).not.toEqual(
            expect.arrayContaining(['Спрощена-2'])
        );
    });

    it('ФОП: dropdown містить усі 4 системи', async () => {
        render(<TaxationSection business={baseBusiness} onSave={jest.fn()} />);
        fireEvent.click(screen.getByLabelText('Редагувати: оподаткування'));
        fireEvent.click(screen.getByRole('button', { name: /спрощена-3/i }));
        const options = await screen.findAllByRole('option');
        const optionLabels = options.map((o) => o.textContent ?? '');
        expect(optionLabels).toEqual(
            expect.arrayContaining([
                'Спрощена-1',
                'Спрощена-2',
                'Спрощена-3',
                'Загальна',
            ])
        );
    });

    it('coupled flip: simplified-3 → simplified-1 ховає VAT-картки і обнуляє draftVat (Sprint 3 §3.8 DoD)', async () => {
        // Sprint plan §3.8 DoD: зміна `simplified-3 → simplified-1` має скинути
        // `isVatPayer` на false, бо ПДВ юридично заборонений на Спрощеній-1/2.
        // Sprint 13 — секція з radio-картками просто ховається (замість disabled-
        // switch); coupled-rule зберігається через primary state: при submit
        // надсилаємо `isVatPayer: false`.
        const onSave = jest.fn().mockResolvedValue(undefined);
        render(<TaxationSection business={baseBusiness} onSave={onSave} />);

        fireEvent.click(screen.getByLabelText('Редагувати: оподаткування'));

        // VAT-картки видимі на simplified-3.
        expect(
            screen.getByRole('radio', { name: /ставка 3% \+ ПДВ/i })
        ).toBeInTheDocument();

        // Open Headless UI Listbox + select 'Спрощена-1'.
        const taxationButton = screen.getByRole('button', {
            name: /спрощена-3/i,
        });
        fireEvent.click(taxationButton);
        const simp1Option = await screen.findByRole('option', {
            name: /спрощена-1/i,
        });
        fireEvent.click(simp1Option);

        // Coupled-flip: VAT-картки зникли з DOM.
        await waitFor(() => {
            expect(
                screen.queryByRole('radio', { name: /ставка/i })
            ).not.toBeInTheDocument();
        });

        // Save → onSave з coupled-валідною парою (isVatPayer=false для simplified-1).
        fireEvent.click(screen.getByText('Зберегти'));
        await waitFor(() =>
            expect(onSave).toHaveBeenCalledWith({
                taxationSystem: 'simplified-1',
                isVatPayer: false,
            })
        );
    });
});
