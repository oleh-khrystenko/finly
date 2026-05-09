import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockUpdateProfile = jest.fn();
const mockGetMe = jest.fn();
const mockSetUser = jest.fn();
const mockOpenAvatarDialog = jest.fn();

jest.mock('@/shared/api', () => ({
    updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
    getMe: (...args: unknown[]) => mockGetMe(...args),
}));

jest.mock('sonner', () => ({
    toast: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/entities/user', () => ({
    useAuthStore: (selector: (s: { setUser: typeof mockSetUser }) => unknown) =>
        selector({ setUser: mockSetUser }),
}));

jest.mock('./avatarUploadDialogStore', () => ({
    useAvatarUploadDialogStore: () => mockOpenAvatarDialog,
}));

import ProfileForm from './ProfileForm';

const baseUser = {
    id: '507f1f77bcf86cd799439011',
    email: 'user@finly.com.ua',
    role: 'user' as const,
    worksAsBookkeeper: false,
    profile: { firstName: 'Іван', lastName: 'Іваненко' },
    executions: { balance: 0, freeReportUsed: false },
    hasPassword: false,
    deletedAt: null,
    accountDeletionRequestedAt: null,
    termsVersion: null,
    billing: null,
};

describe('ProfileForm — lastName is required', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders required asterisk on the lastName label', () => {
        render(<ProfileForm user={baseUser} editable={true} onboardingMode />);

        const lastNameLabel = screen.getByText(/Прізвище/i);
        // The required marker is a sibling `*` span — assert it's in the same label.
        expect(lastNameLabel.closest('label')?.textContent).toContain('*');
    });

    it('rejects submit when lastName is cleared (validation message shown)', async () => {
        render(<ProfileForm user={baseUser} editable={true} onboardingMode />);

        const lastNameInput = screen.getByPlaceholderText(/Ваше прізвище/i);
        fireEvent.change(lastNameInput, { target: { value: '' } });
        fireEvent.blur(lastNameInput);

        // Make form dirty so the submit button renders
        const firstNameInput = screen.getByPlaceholderText(/Ваше ім'я/i);
        fireEvent.change(firstNameInput, { target: { value: 'Інше' } });

        const submit = await screen.findByRole('button', {
            name: /Зберегти/i,
        });
        fireEvent.click(submit);

        await waitFor(() => {
            expect(screen.getByText(/Введіть прізвище/i)).toBeInTheDocument();
        });
        expect(mockUpdateProfile).not.toHaveBeenCalled();
    });

    it('submits firstName + lastName as required non-empty strings', async () => {
        mockUpdateProfile.mockResolvedValue(undefined);
        mockGetMe.mockResolvedValue(baseUser);

        render(<ProfileForm user={baseUser} editable={true} onboardingMode />);

        const firstNameInput = screen.getByPlaceholderText(/Ваше ім'я/i);
        fireEvent.change(firstNameInput, { target: { value: 'Петро' } });

        const submit = await screen.findByRole('button', {
            name: /Зберегти/i,
        });
        fireEvent.click(submit);

        await waitFor(() => {
            expect(mockUpdateProfile).toHaveBeenCalledWith({
                firstName: 'Петро',
                lastName: 'Іваненко',
            });
        });
    });
});
