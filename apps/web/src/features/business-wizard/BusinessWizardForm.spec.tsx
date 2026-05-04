import React from 'react';
import {
    render,
    screen,
    fireEvent,
    waitFor,
    act,
} from '@testing-library/react';

const mockCreateBusiness = jest.fn();
const mockRouterReplace = jest.fn();
const mockToastError = jest.fn();

jest.mock('@/shared/api', () => ({
    createBusiness: (...args: unknown[]) => mockCreateBusiness(...args),
    getApiMessage: (code: string) => `mapped:${code}`,
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: mockRouterReplace }),
}));

jest.mock('sonner', () => ({
    toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

import BusinessWizardForm from './BusinessWizardForm';
import { useBusinessWizardStore } from './businessWizardStore';
import { MVP_BANKS } from '@finly/types';

const VALID_IBAN = 'UA213223130000026007233566001';
const VALID_TAX_ID = '1234567899';

describe('BusinessWizardForm', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useBusinessWizardStore.getState().reset();
        // Очищуємо sessionStorage між тестами — інакше persist із попереднього
        // тесту відновить step > 1 + filled formData.
        sessionStorage.clear();
    });

    describe('Step 1 — type + name', () => {
        it('initial render — Step 1 видимий, "Далі" disabled при empty name', () => {
            render(<BusinessWizardForm />);

            // Step 1 поле "Назва" присутнє
            expect(
                screen.getByPlaceholderText('Іваненко'),
            ).toBeInTheDocument();
            // ФОП-helper text видимий
            expect(
                screen.getByText(/ТОВ і ВАТ — у розробці/i),
            ).toBeInTheDocument();
            // "Далі" disabled
            const nextButton = screen.getByRole('button', { name: /далі/i });
            expect(nextButton).toBeDisabled();
        });

        it('блокує "Далі" поки name невалідний — RHF onChange validation', async () => {
            render(<BusinessWizardForm />);
            const nameInput = screen.getByPlaceholderText('Іваненко');

            // Empty → button disabled
            const button = screen.getByRole('button', { name: /далі/i });
            expect(button).toBeDisabled();

            // Введення валідного name → button enabled (через RHF mode='onChange')
            fireEvent.change(nameInput, { target: { value: 'Іваненко' } });
            await waitFor(() => expect(button).not.toBeDisabled());
        });

        it('Step 1 → Step 2 при валідному name + click "Далі"', async () => {
            render(<BusinessWizardForm />);
            const nameInput = screen.getByPlaceholderText('Іваненко');
            fireEvent.change(nameInput, { target: { value: 'Іваненко' } });

            const button = screen.getByRole('button', { name: /далі/i });
            await waitFor(() => expect(button).not.toBeDisabled());

            fireEvent.click(button);

            // Step 2: IBAN + ІПН поля видимі
            await waitFor(() => {
                expect(
                    screen.getByPlaceholderText(VALID_IBAN),
                ).toBeInTheDocument();
            });
            expect(useBusinessWizardStore.getState().currentStep).toBe(2);
            expect(useBusinessWizardStore.getState().formData.name).toBe(
                'Іваненко',
            );
        });
    });

    describe('Step 3 — coupled VAT × taxationSystem rule (C1)', () => {
        it('VAT switch disabled при taxationSystem=simplified-1 (UI guard)', () => {
            // Pre-populate store до Step 3 з simplified-1.
            act(() => {
                useBusinessWizardStore.setState({
                    currentStep: 3,
                    formData: {
                        type: 'fop',
                        name: 'Іваненко',
                        requisites: { iban: VALID_IBAN, taxId: VALID_TAX_ID },
                        taxationSystem: 'simplified-1',
                        isVatPayer: false,
                        acceptedBanks: [...MVP_BANKS],
                    },
                });
            });

            render(<BusinessWizardForm />);

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

        it('VAT switch enabled при taxationSystem=simplified-3', () => {
            act(() => {
                useBusinessWizardStore.setState({
                    currentStep: 3,
                    formData: {
                        type: 'fop',
                        name: 'Іваненко',
                        requisites: { iban: VALID_IBAN, taxId: VALID_TAX_ID },
                        taxationSystem: 'simplified-3',
                        isVatPayer: false,
                        acceptedBanks: [...MVP_BANKS],
                    },
                });
            });

            render(<BusinessWizardForm />);

            const vatSwitch = screen.getByRole('switch', {
                name: /платник пдв/i,
            });
            expect(vatSwitch).not.toBeDisabled();
        });
    });

    describe('Step 4 — submit з правильним payload', () => {
        it('викликає createBusiness з повним CreateBusinessRequest при click "Створити"', async () => {
            // Pre-populate store з валідним state, що повністю passes
            // CreateBusinessSchema.safeParse у Step 4 onSubmit.
            act(() => {
                useBusinessWizardStore.setState({
                    currentStep: 4,
                    formData: {
                        type: 'fop',
                        name: 'Іваненко',
                        requisites: { iban: VALID_IBAN, taxId: VALID_TAX_ID },
                        taxationSystem: 'simplified-3',
                        isVatPayer: true,
                        paymentPurposeTemplate: 'Оплата за послуги',
                        acceptedBanks: [...MVP_BANKS],
                    },
                });
            });
            mockCreateBusiness.mockResolvedValue({
                slug: 'aB3xQ9k7',
                id: '507f1f77bcf86cd799439011',
            });

            render(<BusinessWizardForm />);

            const createButton = screen.getByRole('button', {
                name: /створити/i,
            });
            fireEvent.click(createButton);

            await waitFor(() =>
                expect(mockCreateBusiness).toHaveBeenCalledTimes(1),
            );
            // Payload — повний CreateBusinessRequest з усіма 7 полями
            expect(mockCreateBusiness).toHaveBeenCalledWith({
                type: 'fop',
                name: 'Іваненко',
                requisites: { iban: VALID_IBAN, taxId: VALID_TAX_ID },
                taxationSystem: 'simplified-3',
                isVatPayer: true,
                paymentPurposeTemplate: 'Оплата за послуги',
                acceptedBanks: [...MVP_BANKS],
            });

            // Redirect на /business/{slug}
            await waitFor(() =>
                expect(mockRouterReplace).toHaveBeenCalledWith(
                    '/business/aB3xQ9k7',
                ),
            );
        });

        it('reset wizard store після successful submit', async () => {
            act(() => {
                useBusinessWizardStore.setState({
                    currentStep: 4,
                    formData: {
                        type: 'fop',
                        name: 'Іваненко',
                        requisites: { iban: VALID_IBAN, taxId: VALID_TAX_ID },
                        taxationSystem: 'simplified-3',
                        isVatPayer: false,
                        paymentPurposeTemplate: 'Оплата',
                        acceptedBanks: [...MVP_BANKS],
                    },
                });
            });
            mockCreateBusiness.mockResolvedValue({ slug: 'X', id: '1' });

            render(<BusinessWizardForm />);
            fireEvent.click(screen.getByRole('button', { name: /створити/i }));

            await waitFor(() =>
                expect(mockRouterReplace).toHaveBeenCalled(),
            );
            // Sprint 3 §3.7 — reset тільки після submit success.
            expect(useBusinessWizardStore.getState().currentStep).toBe(1);
            expect(
                useBusinessWizardStore.getState().formData.name,
            ).toBeUndefined();
        });

        it('reset wizard на Step 1 + toast.error при stale formData (CreateBusinessSchema fail)', async () => {
            // Симулюємо stale sessionStorage drift: формат полів змінився між
            // версіями, persisted state містить name (запобігає render-effect
            // recovery на Step 1), але `requisites` відсутні. Step 4 final
            // safeParse — last-line-of-defense для такого випадку: ловить
            // incomplete payload, toast + reset на Step 1 без API call.
            act(() => {
                useBusinessWizardStore.setState({
                    currentStep: 4,
                    formData: {
                        type: 'fop',
                        name: 'Іваненко',
                        // requisites навмисно відсутні → CreateBusinessSchema fail
                        taxationSystem: 'simplified-3',
                        isVatPayer: false,
                        acceptedBanks: [...MVP_BANKS],
                    },
                });
            });

            render(<BusinessWizardForm />);
            // Step 4 local state потребує валідних purpose + banks для
            // enabled "Створити". Заповнюємо purpose textarea.
            const purpose = screen.getByPlaceholderText(
                /оплата за послуги/i,
            );
            fireEvent.change(purpose, { target: { value: 'Оплата' } });

            const createButton = screen.getByRole('button', {
                name: /створити/i,
            });
            await waitFor(() => expect(createButton).not.toBeDisabled());
            fireEvent.click(createButton);

            await waitFor(() => expect(mockToastError).toHaveBeenCalled());
            // API НЕ викликаний — incomplete payload зловлено client-side.
            expect(mockCreateBusiness).not.toHaveBeenCalled();
            // Wizard скинуто на Step 1.
            expect(useBusinessWizardStore.getState().currentStep).toBe(1);
        });
    });
});
