import React from 'react';
import { render, screen } from '@testing-library/react';
import type { PublicCatalogView } from '@finly/types';
import PublicCatalog from './PublicCatalog';

const CATALOG: PublicCatalogView = {
    sections: [
        {
            category: 'state',
            payees: [
                {
                    type: 'organization',
                    name: 'Головне управління ДПС',
                    slug: 'dps-lviv',
                    accounts: [
                        {
                            slug: 'esv',
                            name: 'ЄСВ',
                            bankCode: null,
                            ibanMask: '•6001',
                        },
                    ],
                },
            ],
        },
        {
            category: 'charity',
            payees: [
                {
                    type: 'organization',
                    name: 'Фонд',
                    slug: 'fond',
                    accounts: [],
                },
            ],
        },
    ],
};

describe('PublicCatalog (Sprint 29)', () => {
    it('рендерить секції-категорії з їхніми лейблами', () => {
        render(<PublicCatalog catalog={CATALOG} />);
        expect(screen.getByText('Державні платежі')).toBeInTheDocument();
        expect(screen.getByText('Благодійність')).toBeInTheDocument();
    });

    it('картка отримувача веде на його публічну сторінку', () => {
        render(<PublicCatalog catalog={CATALOG} />);
        const link = screen.getByRole('link', {
            name: /Головне управління ДПС/,
        });
        expect(link).toHaveAttribute('href', '/dps-lviv');
    });

    it('показує лейбли реквізитів, а без них — заклик переглянути', () => {
        render(<PublicCatalog catalog={CATALOG} />);
        expect(screen.getByText('ЄСВ')).toBeInTheDocument();
        expect(screen.getByText('Переглянути реквізити')).toBeInTheDocument();
    });
});
