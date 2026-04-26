import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// HeadlessUI Listbox requires ResizeObserver which jsdom doesn't provide
global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

// Mock next-intl — return key as translation
jest.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
    useLocale: () => 'en',
}));

// Mock API
const mockSubmitBrief = jest.fn();
jest.mock('@/shared/api/agency', () => ({
    submitBrief: (...args: unknown[]) => mockSubmitBrief(...args),
    submitAuthenticatedBrief: jest.fn(),
}));

jest.mock('@/shared/api/auth', () => ({
    getMe: jest.fn(),
}));

jest.mock('@/entities/user', () => ({
    useAuthStore: Object.assign(
        (selector: (s: any) => any) => selector({ user: null }),
        { getState: () => ({ user: null, setUser: jest.fn() }) }
    ),
}));

jest.mock('./briefDialogStore', () => ({
    useBriefDialogStore: Object.assign(
        (selector: (s: any) => any) => selector({ requestAiBonus: false }),
        { getState: () => ({ requestAiBonus: false }) }
    ),
}));

// Mock mapApiCode
jest.mock('@/shared/api/mapApiCode', () => ({
    getApiMessageKey: (code: string) => `mapped.${code}`,
}));

// Mock Turnstile hook
const mockExecute = jest.fn();
const mockReset = jest.fn();
jest.mock('./lib/useTurnstile', () => ({
    useTurnstile: () => ({
        containerRef: { current: null },
        execute: (...args: unknown[]) => mockExecute(...args),
        reset: mockReset,
    }),
}));

// Mock source
jest.mock('./lib/source', () => ({
    getSource: () => 'direct',
}));

// Mock sonner toast
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
jest.mock('sonner', () => ({
    toast: {
        success: (...args: unknown[]) => mockToastSuccess(...args),
        error: (...args: unknown[]) => mockToastError(...args),
    },
}));

import BriefForm from './BriefForm';

describe('BriefForm', () => {
    const mockOnSuccess = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        mockExecute.mockResolvedValue('test-captcha-token');
        mockSubmitBrief.mockResolvedValue({ code: 'BRIEF_SUBMITTED' });
    });

    it('renders all form fields', () => {
        render(<BriefForm onSuccess={mockOnSuccess} />);

        expect(
            screen.getByPlaceholderText('name_placeholder'),
        ).toBeInTheDocument();
        expect(
            screen.getByPlaceholderText('email_placeholder'),
        ).toBeInTheDocument();
        expect(
            screen.getByPlaceholderText('description_placeholder'),
        ).toBeInTheDocument();
        expect(screen.getByText('submit')).toBeInTheDocument();
    });

    it('shows error toast when captcha token is not ready', async () => {
        mockExecute.mockRejectedValue(new Error('Turnstile not ready'));

        render(<BriefForm onSuccess={mockOnSuccess} />);

        fireEvent.change(screen.getByPlaceholderText('name_placeholder'), {
            target: { value: 'John Doe' },
        });
        fireEvent.change(screen.getByPlaceholderText('email_placeholder'), {
            target: { value: 'john@example.com' },
        });
        fireEvent.change(
            screen.getByPlaceholderText('description_placeholder'),
            {
                target: {
                    value: 'A project description that is long enough for validation',
                },
            },
        );

        const budgetSelect = screen.getByText('budget_placeholder');
        fireEvent.click(budgetSelect);
        const budgetOption = await screen.findByText('budget_under_2500');
        fireEvent.click(budgetOption);

        fireEvent.submit(screen.getByText('submit').closest('form')!);

        await waitFor(() => {
            expect(mockToastError).toHaveBeenCalledWith('captcha_not_ready');
        });
        expect(mockSubmitBrief).not.toHaveBeenCalled();
    });

    it('shows validation errors for empty required fields', async () => {
        render(<BriefForm onSuccess={mockOnSuccess} />);

        fireEvent.submit(screen.getByText('submit').closest('form')!);

        // Zod validation should catch empty name, email, description, budget
        await waitFor(() => {
            expect(screen.getByText('validation_name_required')).toBeInTheDocument();
        });

        expect(mockSubmitBrief).not.toHaveBeenCalled();
    });

    it('calls submitBrief and onSuccess on successful submission', async () => {
        render(<BriefForm onSuccess={mockOnSuccess} />);

        fireEvent.change(screen.getByPlaceholderText('name_placeholder'), {
            target: { value: 'John Doe' },
        });
        fireEvent.change(screen.getByPlaceholderText('email_placeholder'), {
            target: { value: 'john@example.com' },
        });
        fireEvent.change(
            screen.getByPlaceholderText('description_placeholder'),
            {
                target: {
                    value: 'A project description that is long enough for validation',
                },
            },
        );

        // Select budget via UiSelect — click to open, then select option
        const budgetSelect = screen.getByText('budget_placeholder');
        fireEvent.click(budgetSelect);
        const budgetOption = await screen.findByText('budget_under_2500');
        fireEvent.click(budgetOption);

        fireEvent.submit(screen.getByText('submit').closest('form')!);

        await waitFor(() => {
            expect(mockSubmitBrief).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'John Doe',
                    email: 'john@example.com',
                    budget: 'under_2500',
                    captchaToken: 'test-captcha-token',
                    source: 'direct',
                }),
            );
        });

        await waitFor(() => {
            expect(mockOnSuccess).toHaveBeenCalled();
        });

        expect(mockToastSuccess).toHaveBeenCalled();
    });
});
