import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

const mockRouterReplace = jest.fn();
const mockRouterPush = jest.fn();
let mockSearchParams = new URLSearchParams();
const mockPathname = '/business/iva-X3kQ/account/acc-aB12cD34';
const BUSINESS_SLUG = 'iva-X3kQ';

jest.mock('next/navigation', () => ({
    useRouter: () => ({
        replace: mockRouterReplace,
        push: mockRouterPush,
    }),
    usePathname: () => mockPathname,
    useSearchParams: () => mockSearchParams,
}));

import CompletedFromLandingBanner from './CompletedFromLandingBanner';

describe('CompletedFromLandingBanner', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSearchParams = new URLSearchParams();
    });

    it('returns null коли ?completed-from відсутній', () => {
        mockSearchParams = new URLSearchParams();
        const { container } = render(
            <CompletedFromLandingBanner businessSlug={BUSINESS_SLUG} />
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('returns null коли ?completed-from має інше значення (не "landing")', () => {
        mockSearchParams = new URLSearchParams('?completed-from=other');
        const { container } = render(
            <CompletedFromLandingBanner businessSlug={BUSINESS_SLUG} />
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('рендерить новий заголовок + опис + CTA коли ?completed-from=landing', () => {
        mockSearchParams = new URLSearchParams('?completed-from=landing');
        render(<CompletedFromLandingBanner businessSlug={BUSINESS_SLUG} />);

        expect(
            screen.getByText('Бізнес і рахунок збережено з лендінгу')
        ).toBeInTheDocument();
        expect(
            screen.getByText(/За замовчуванням бізнес приймає всі 11 банків/)
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /Перейти до банків/ })
        ).toBeInTheDocument();
    });

    it('CTA "Перейти до банків" робить cross-page push на /business/{slug}#banks', () => {
        mockSearchParams = new URLSearchParams('?completed-from=landing');
        render(<CompletedFromLandingBanner businessSlug={BUSINESS_SLUG} />);

        fireEvent.click(
            screen.getByRole('button', { name: /Перейти до банків/ })
        );

        expect(mockRouterPush).toHaveBeenCalledWith(
            `/business/${BUSINESS_SLUG}#banks`
        );
    });

    it('dismiss (X) видаляє query-param через router.replace без створення history-entry', () => {
        mockSearchParams = new URLSearchParams('?completed-from=landing');
        render(<CompletedFromLandingBanner businessSlug={BUSINESS_SLUG} />);

        const dismissBtn = screen.getByRole('button', {
            name: /Сховати повідомлення/,
        });
        fireEvent.click(dismissBtn);

        expect(mockRouterReplace).toHaveBeenCalledTimes(1);
        expect(mockRouterReplace).toHaveBeenCalledWith(mockPathname);
    });

    it('dismiss зберігає інші query-params (preserve-семантика)', () => {
        mockSearchParams = new URLSearchParams(
            '?completed-from=landing&debug=on'
        );
        render(<CompletedFromLandingBanner businessSlug={BUSINESS_SLUG} />);

        fireEvent.click(
            screen.getByRole('button', { name: /Сховати повідомлення/ })
        );

        expect(mockRouterReplace).toHaveBeenCalledWith(
            `${mockPathname}?debug=on`
        );
    });

    it('має aria-live="polite" для accessibility', () => {
        mockSearchParams = new URLSearchParams('?completed-from=landing');
        render(<CompletedFromLandingBanner businessSlug={BUSINESS_SLUG} />);

        const region = screen.getByRole('status');
        expect(region).toHaveAttribute('aria-live', 'polite');
    });
});
