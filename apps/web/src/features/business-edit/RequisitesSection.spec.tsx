import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Business, BusinessType } from '@finly/types';
import RequisitesSection from './RequisitesSection';

const VALID_RNOKPP = '1234567899';
const VALID_EDRPOU = '12345678';

/**
 * Sprint 7 §SP-3 + Sprint 9 §9.2 — Business shape:
 *  - taxId top-level (раніше requisites.taxId);
 *  - без iban (живе на Account);
 *  - без invoiceSlugPresetDefault.
 */
function makeBusiness(
    overrides: Partial<Business> & { type: BusinessType } = { type: 'fop' }
): Business {
    const base: Business = {
        id: '507f1f77bcf86cd799439011',
        type: overrides.type,
        ownerId: '507f1f77bcf86cd799439012',
        managers: [],
        slug: 'IvanEnko',
        slugLower: 'ivanenko',
        name: 'Іваненко',
        taxId: VALID_RNOKPP,
        taxationSystem:
            overrides.type === 'fop' || overrides.type === 'tov'
                ? 'simplified-3'
                : null,
        isVatPayer:
            overrides.type === 'fop' || overrides.type === 'tov' ? false : null,
        paymentPurposeTemplate: 'Оплата',
        seoIndexEnabled: false,
        deletedAt: null,
        accessBlockedAt: null,
        createdAt: new Date('2026-05-01'),
        updatedAt: new Date('2026-05-01'),
    };
    return { ...base, ...overrides };
}

describe('RequisitesSection — Sprint 7 §SP-4 + Sprint 9 §9.2 (taxId only)', () => {
    it.each([
        ['individual', 'РНОКПП', VALID_RNOKPP, '10'],
        ['fop', 'РНОКПП', VALID_RNOKPP, '10'],
        ['tov', 'ЄДРПОУ', VALID_EDRPOU, '8'],
        ['organization', 'ЄДРПОУ', VALID_EDRPOU, '8'],
    ] as const)(
        '%s бізнес — label "%s", maxLength=%s',
        async (type, expectedLabel, validValue, expectedMaxLength) => {
            const business = makeBusiness({ type, taxId: validValue });
            render(
                <RequisitesSection business={business} onSave={jest.fn()} />
            );

            // Label видимий у read-mode
            expect(screen.getByText(expectedLabel)).toBeInTheDocument();

            // Тригеримо edit-mode для перевірки maxLength
            fireEvent.click(
                screen.getByLabelText(`Редагувати: ${expectedLabel}`)
            );
            const input = screen.getByDisplayValue(validValue);
            expect(input).toHaveAttribute('maxlength', expectedMaxLength);
        }
    );

    it('fop валідатор reject-ить 8-digit ЄДРПОУ (cross-type)', async () => {
        const onSave = jest.fn();
        const business = makeBusiness({ type: 'fop' });
        render(<RequisitesSection business={business} onSave={onSave} />);

        fireEvent.click(screen.getByLabelText('Редагувати: РНОКПП'));
        const input = screen.getByDisplayValue(VALID_RNOKPP);
        // Замінюємо на ЄДРПОУ-довжину — валідатор `individualTaxIdZod`
        // повинен reject-нути (RNOKPP = 10 digits + checksum, не 8).
        fireEvent.change(input, { target: { value: VALID_EDRPOU } });
        fireEvent.click(screen.getByText('Зберегти'));

        // onSave НЕ викликається — UiEditableField блокує save при невалідному
        // value через `validate`-callback.
        await waitFor(() => {
            expect(onSave).not.toHaveBeenCalled();
        });
    });

    it('tov валідатор приймає 8-digit ЄДРПОУ', async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        const business = makeBusiness({ type: 'tov', taxId: VALID_EDRPOU });
        render(<RequisitesSection business={business} onSave={onSave} />);

        fireEvent.click(screen.getByLabelText('Редагувати: ЄДРПОУ'));
        const input = screen.getByDisplayValue(VALID_EDRPOU);
        // Заміна на інший валідний 8-digit ЄДРПОУ → save проходить.
        fireEvent.change(input, { target: { value: '87654321' } });
        fireEvent.click(screen.getByText('Зберегти'));

        await waitFor(() => {
            expect(onSave).toHaveBeenCalledWith({ taxId: '87654321' });
        });
    });
});
