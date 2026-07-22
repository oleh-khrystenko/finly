import React from 'react';
import { render, screen } from '@testing-library/react';
import type { Business, BusinessBrand } from '@finly/types';

// Барель `@/shared/api` тягне axios-client → config/env (NEXT_PUBLIC_* fail-fast),
// що крашить у jsdom. Render-тест мережу не використовує — мокаємо споживане.
jest.mock('@/shared/api', () => ({
    deleteBrandLogo: jest.fn(),
    extractApiErrorCode: jest.fn(() => 'unknown'),
    getApiMessage: jest.fn(() => 'error'),
}));

import BrandSection from './BrandSection';

const SLOT = {
    logoUrl: 'https://media.test/brand-logos/x/a.png',
    centerMarkUrl: 'https://media.test/brand-logos/x/c.png',
    bandMarkUrl: 'https://media.test/brand-logos/x/b.png',
    displayName: null,
};

function makeBusiness(brand: BusinessBrand | null): Business {
    return {
        id: '507f1f77bcf86cd799439011',
        type: 'fop',
        ownerId: '507f1f77bcf86cd799439012',
        managers: [],
        slug: 'kvity',
        slugLower: 'kvity',
        name: 'Квіти',
        taxId: '1234567899',
        taxationSystem: 'simplified-3',
        isVatPayer: false,
        paymentPurposeTemplate: 'Оплата',
        seoIndexEnabled: false,
        deletedAt: null,
        brandedAt: null,
        brand,
        isSystem: false,
        slugCustomized: false,
        catalogVisible: false,
        publicityStatus: 'none',
        publicityRequestedAt: null,
        publicityReviewedAt: null,
        publicityRejectionReason: null,
        catalogCategory: 'business',
        createdAt: new Date('2026-06-01'),
        updatedAt: new Date('2026-06-01'),
    };
}

function renderSection(brand: BusinessBrand | null) {
    return render(
        <BrandSection
            business={makeBusiness(brand)}
            isPaid={true}
            onSubscribe={() => {}}
            subscribePriceLabel="Підписатись · 49 грн/міс"
            onApplied={() => {}}
        />
    );
}

describe('BrandSection', () => {
    it('без бренду: дефолтний Finly + кнопка завантаження', () => {
        renderSection(null);
        expect(
            screen.getByText(/стандартний брендинг Finly/i)
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Завантажити логотип' })
        ).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Видалити' })
        ).not.toBeInTheDocument();
    });

    it('активний бренд: логотип + Замінити + Видалити', () => {
        renderSection({ active: SLOT, pending: null });
        expect(screen.getByAltText('Логотип бренду')).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Замінити логотип' })
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Видалити' })
        ).toBeInTheDocument();
    });

    it('pending бренд: статус «Очікує оплати» + підказка про авто-застосування', () => {
        renderSection({
            active: null,
            pending: {
                ...SLOT,
                uploadedAt: new Date('2026-06-10'),
                demoted: false,
            },
        });
        expect(screen.getByText('Очікує оплати')).toBeInTheDocument();
        expect(
            screen.getByText(/застосується автоматично після оформлення/i)
        ).toBeInTheDocument();
    });
});
