import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

const mockRouterReplace = jest.fn();
let mockSearchParams = new URLSearchParams();
const mockPathname = '/business/iva-X3kQ';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: mockRouterReplace, push: jest.fn() }),
    usePathname: () => mockPathname,
    useSearchParams: () => mockSearchParams,
}));

import CompletedFromLandingBanner from './CompletedFromLandingBanner';

describe('CompletedFromLandingBanner', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSearchParams = new URLSearchParams();
    });

    it('returns null коли ?completed-from відсутній (no banner на повторних відкриттях)', () => {
        mockSearchParams = new URLSearchParams();
        const { container } = render(<CompletedFromLandingBanner />);
        expect(container).toBeEmptyDOMElement();
    });

    it('returns null коли ?completed-from має інше значення (не "landing")', () => {
        mockSearchParams = new URLSearchParams('?completed-from=other');
        const { container } = render(<CompletedFromLandingBanner />);
        expect(container).toBeEmptyDOMElement();
    });

    it('рендерить заголовок + опис + CTA коли ?completed-from=landing', () => {
        mockSearchParams = new URLSearchParams('?completed-from=landing');
        render(<CompletedFromLandingBanner />);

        expect(
            screen.getByText('Дані з лендінгу збережено')
        ).toBeInTheDocument();
        expect(
            screen.getByText(/За замовчуванням бізнес приймає всі 11 банків/)
        ).toBeInTheDocument();
        const cta = screen.getByRole('link', { name: /Перейти до банків/ });
        expect(cta).toHaveAttribute('href', '#banks');
    });

    it('dismiss (X) видаляє query-param через router.replace без створення history-entry', () => {
        mockSearchParams = new URLSearchParams('?completed-from=landing');
        render(<CompletedFromLandingBanner />);

        const dismissBtn = screen.getByRole('button', {
            name: /Сховати повідомлення/,
        });
        fireEvent.click(dismissBtn);

        // router.replace, НЕ push (дізмис не повинен потрапити у back-history).
        expect(mockRouterReplace).toHaveBeenCalledTimes(1);
        // Pathname збережений, query-param очищений.
        expect(mockRouterReplace).toHaveBeenCalledWith(mockPathname);
    });

    it('dismiss зберігає інші query-params (preserve-семантика)', () => {
        mockSearchParams = new URLSearchParams(
            '?completed-from=landing&debug=on'
        );
        render(<CompletedFromLandingBanner />);

        fireEvent.click(
            screen.getByRole('button', { name: /Сховати повідомлення/ })
        );

        expect(mockRouterReplace).toHaveBeenCalledWith(
            `${mockPathname}?debug=on`
        );
    });

    it('має aria-live="polite" для accessibility (screen-reader announcement)', () => {
        mockSearchParams = new URLSearchParams('?completed-from=landing');
        render(<CompletedFromLandingBanner />);

        const region = screen.getByRole('status');
        expect(region).toHaveAttribute('aria-live', 'polite');
    });
});
