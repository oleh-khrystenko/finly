import React from 'react';
import { render } from '@testing-library/react';

const mockClearUser = jest.fn();
const mockToastInfo = jest.fn();
const mockReplace = jest.fn();

let mockSearchParams = new URLSearchParams();
const mockPathname = '/auth/signin';

jest.mock('@/entities/user', () => ({
    useAuthStore: {
        getState: () => ({ clearUser: mockClearUser }),
    },
}));

jest.mock('sonner', () => ({
    toast: {
        info: (msg: string) => mockToastInfo(msg),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: mockReplace }),
    useSearchParams: () => mockSearchParams,
    usePathname: () => mockPathname,
}));

import SessionExpiredHandler from './SessionExpiredHandler';

describe('SessionExpiredHandler', () => {
    beforeEach(() => {
        mockClearUser.mockClear();
        mockToastInfo.mockClear();
        mockReplace.mockClear();
        mockSearchParams = new URLSearchParams();
    });

    it('clears user, shows toast, and strips ?reason when reason=session-expired', () => {
        mockSearchParams = new URLSearchParams('reason=session-expired');

        render(<SessionExpiredHandler />);

        expect(mockClearUser).toHaveBeenCalledTimes(1);
        expect(mockToastInfo).toHaveBeenCalledWith(
            'Термін дії сесії закінчився. Будь ласка, увійдіть знову.',
        );
        // No other params → URL becomes the bare pathname.
        expect(mockReplace).toHaveBeenCalledWith('/auth/signin', {
            scroll: false,
        });
    });

    it('preserves other query params when stripping ?reason', () => {
        // A logged-in user redirected from /billing should preserve the
        // original `redirect` param so signin can return them after login.
        mockSearchParams = new URLSearchParams(
            'reason=session-expired&redirect=%2Fbilling&email=foo%40bar.com',
        );

        render(<SessionExpiredHandler />);

        expect(mockReplace).toHaveBeenCalledTimes(1);
        const replacedUrl: string = mockReplace.mock.calls[0][0];
        expect(replacedUrl).toContain('/auth/signin?');
        expect(replacedUrl).toContain('redirect=%2Fbilling');
        expect(replacedUrl).toContain('email=foo%40bar.com');
        expect(replacedUrl).not.toContain('reason=');
    });

    it('does nothing when reason param is absent', () => {
        mockSearchParams = new URLSearchParams();

        render(<SessionExpiredHandler />);

        expect(mockClearUser).not.toHaveBeenCalled();
        expect(mockToastInfo).not.toHaveBeenCalled();
        expect(mockReplace).not.toHaveBeenCalled();
    });

    it('does nothing when reason has an unrelated value', () => {
        mockSearchParams = new URLSearchParams('reason=something-else');

        render(<SessionExpiredHandler />);

        expect(mockClearUser).not.toHaveBeenCalled();
        expect(mockToastInfo).not.toHaveBeenCalled();
        expect(mockReplace).not.toHaveBeenCalled();
    });

    it('does nothing on subsequent renders if already handled', () => {
        // Simulates a parent re-render after the handler already fired.
        // The ref-based guard must ensure the toast/clear happens once.
        mockSearchParams = new URLSearchParams('reason=session-expired');

        const { rerender } = render(<SessionExpiredHandler />);
        rerender(<SessionExpiredHandler />);

        expect(mockClearUser).toHaveBeenCalledTimes(1);
        expect(mockToastInfo).toHaveBeenCalledTimes(1);
        expect(mockReplace).toHaveBeenCalledTimes(1);
    });

    it('renders nothing (no visible output)', () => {
        mockSearchParams = new URLSearchParams('reason=session-expired');

        const { container } = render(<SessionExpiredHandler />);

        expect(container.innerHTML).toBe('');
    });
});
