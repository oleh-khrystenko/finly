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
const VALID_RNOKPP = '1234567899';
const VALID_EDRPOU = '12345678';

describe('BusinessWizardForm', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useBusinessWizardStore.getState().reset();
        // Очищуємо sessionStorage між тестами — інакше persist із попереднього
        // тесту відновить step != 'type-name' + filled formData.
        sessionStorage.clear();
    });

    describe("Step 'type-name' — radio-cards (Sprint 7 §SP-1)", () => {
        it('initial render — 4 radio-cards видимі, "Далі" disabled', () => {
            render(<BusinessWizardForm />);

            // 4 radio-cards
            expect(
                screen.getByRole('radio', { name: /Я особисто/ }),
            ).toBeInTheDocument();
            expect(
                screen.getByRole('radio', { name: /^ФОП/ }),
            ).toBeInTheDocument();
            expect(
                screen.getByRole('radio', { name: /^ТОВ/ }),
            ).toBeInTheDocument();
            expect(
                screen.getByRole('radio', { name: /ОСББ/ }),
            ).toBeInTheDocument();

            const nextButton = screen.getByRole('button', { name: /далі/i });
            expect(nextButton).toBeDisabled();
        });

        it('блокує "Далі" поки type не обраний (хоча name валідний)', async () => {
            render(<BusinessWizardForm />);

            const nameInput = screen.getByPlaceholderText('Іваненко');
            fireEvent.change(nameInput, { target: { value: 'Іваненко' } });

            const button = screen.getByRole('button', { name: /далі/i });
            // name валідний, але type не обраний → all-conditions disabled
            await waitFor(() => expect(button).toBeDisabled());
        });

        it('блокує "Далі" поки name невалідний (хоча type обраний)', async () => {
            render(<BusinessWizardForm />);
            fireEvent.click(screen.getByRole('radio', { name: /^ФОП/ }));

            const button = screen.getByRole('button', { name: /далі/i });
            await waitFor(() => expect(button).toBeDisabled());
        });

        it("type=fop + valid name → перехід на step 'requisites'", async () => {
            render(<BusinessWizardForm />);

            fireEvent.click(screen.getByRole('radio', { name: /^ФОП/ }));
            const nameInput = screen.getByPlaceholderText('Іваненко');
            fireEvent.change(nameInput, { target: { value: 'Іваненко' } });

            const button = screen.getByRole('button', { name: /далі/i });
            await waitFor(() => expect(button).not.toBeDisabled());
            fireEvent.click(button);

            await waitFor(() => {
                expect(
                    screen.getByPlaceholderText(VALID_IBAN),
                ).toBeInTheDocument();
            });
            expect(useBusinessWizardStore.getState().currentStep).toBe(
                'requisites',
            );
            expect(useBusinessWizardStore.getState().formData.type).toBe(
                'fop',
            );
            expect(useBusinessWizardStore.getState().formData.name).toBe(
                'Іваненко',
            );
        });
    });

    describe('Step requisites — type-aware taxId (Sprint 7 §SP-4)', () => {
        it('fop — label "РНОКПП", maxLength=10, валідатор reject-ить 8-digit ЄДРПОУ', async () => {
            act(() => {
                useBusinessWizardStore.setState({
                    currentStep: 'requisites',
                    formData: {
                        type: 'fop',
                        name: 'Іваненко',
                        acceptedBanks: [...MVP_BANKS],
                    },
                });
            });
            render(<BusinessWizardForm />);

            const taxIdInput = screen.getByLabelText('РНОКПП');
            expect(taxIdInput).toHaveAttribute('maxlength', '10');
            // 8-digit ЄДРПОУ — невалідний для fop
            fireEvent.change(taxIdInput, { target: { value: VALID_EDRPOU } });
            // IBAN треба валідний, інакше Form-isValid має іншу причину false
            const ibanInput = screen.getByPlaceholderText(VALID_IBAN);
            fireEvent.change(ibanInput, { target: { value: VALID_IBAN } });

            const nextButton = screen.getByRole('button', { name: /далі/i });
            await waitFor(() => expect(nextButton).toBeDisabled());
        });

        it('tov — label "ЄДРПОУ", maxLength=8, валідатор приймає 8-digit', async () => {
            act(() => {
                useBusinessWizardStore.setState({
                    currentStep: 'requisites',
                    formData: {
                        type: 'tov',
                        name: 'ТОВ Каса',
                        acceptedBanks: [...MVP_BANKS],
                    },
                });
            });
            render(<BusinessWizardForm />);

            const taxIdInput = screen.getByLabelText('ЄДРПОУ');
            expect(taxIdInput).toHaveAttribute('maxlength', '8');
            const ibanInput = screen.getByPlaceholderText(VALID_IBAN);
            fireEvent.change(ibanInput, { target: { value: VALID_IBAN } });
            fireEvent.change(taxIdInput, { target: { value: VALID_EDRPOU } });

            const nextButton = screen.getByRole('button', { name: /далі/i });
            await waitFor(() => expect(nextButton).not.toBeDisabled());
        });

        it('individual — приймає 10-digit RNOKPP', async () => {
            act(() => {
                useBusinessWizardStore.setState({
                    currentStep: 'requisites',
                    formData: {
                        type: 'individual',
                        name: 'Іваненко',
                        acceptedBanks: [...MVP_BANKS],
                    },
                });
            });
            render(<BusinessWizardForm />);

            const taxIdInput = screen.getByLabelText('РНОКПП');
            expect(taxIdInput).toHaveAttribute('maxlength', '10');
            const ibanInput = screen.getByPlaceholderText(VALID_IBAN);
            fireEvent.change(ibanInput, { target: { value: VALID_IBAN } });
            fireEvent.change(taxIdInput, { target: { value: VALID_RNOKPP } });

            const nextButton = screen.getByRole('button', { name: /далі/i });
            await waitFor(() => expect(nextButton).not.toBeDisabled());
        });
    });

    describe("Step 'taxation' — coupled VAT × taxationSystem rule (C1)", () => {
        it('VAT switch disabled при taxationSystem=simplified-1 (UI guard)', () => {
            act(() => {
                useBusinessWizardStore.setState({
                    currentStep: 'taxation',
                    formData: {
                        type: 'fop',
                        name: 'Іваненко',
                        requisites: { iban: VALID_IBAN, taxId: VALID_RNOKPP },
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
        });

        it('VAT switch enabled при taxationSystem=simplified-3', () => {
            act(() => {
                useBusinessWizardStore.setState({
                    currentStep: 'taxation',
                    formData: {
                        type: 'fop',
                        name: 'Іваненко',
                        requisites: { iban: VALID_IBAN, taxId: VALID_RNOKPP },
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

        it("Sprint 7 §SP-7 — defensive redirect: type=individual на step 'taxation' → setStep('purpose-banks')", () => {
            // Stale-state recovery: користувач якось потрапив сюди (URL,
            // devtools), але type не вимагає оподаткування. Step3Taxation
            // ефект redirect-ить на наступний логічний крок без render-у форми.
            act(() => {
                useBusinessWizardStore.setState({
                    currentStep: 'taxation',
                    formData: {
                        type: 'individual',
                        name: 'Іваненко',
                        requisites: { iban: VALID_IBAN, taxId: VALID_RNOKPP },
                        acceptedBanks: [...MVP_BANKS],
                    },
                });
            });

            render(<BusinessWizardForm />);

            // Effect виконується після першого render-у. Чекаємо стейт-зміни.
            return waitFor(() => {
                expect(useBusinessWizardStore.getState().currentStep).toBe(
                    'purpose-banks',
                );
            });
        });
    });

    describe("Step 'purpose-banks' — submit з 4-type-aware payload-ом", () => {
        it("fop submit з повним CreateBusinessRequest (taxation присутній)", async () => {
            act(() => {
                useBusinessWizardStore.setState({
                    currentStep: 'purpose-banks',
                    formData: {
                        type: 'fop',
                        name: 'Іваненко',
                        requisites: { iban: VALID_IBAN, taxId: VALID_RNOKPP },
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
            expect(mockCreateBusiness).toHaveBeenCalledWith({
                type: 'fop',
                name: 'Іваненко',
                requisites: { iban: VALID_IBAN, taxId: VALID_RNOKPP },
                taxationSystem: 'simplified-3',
                isVatPayer: true,
                paymentPurposeTemplate: 'Оплата за послуги',
                acceptedBanks: [...MVP_BANKS],
            });
            await waitFor(() =>
                expect(mockRouterReplace).toHaveBeenCalledWith(
                    '/business/aB3xQ9k7',
                ),
            );
        });

        it("individual submit БЕЗ taxation-полів (Sprint 7 §SP-3 discriminated union)", async () => {
            // Backend reject-нув би taxation-поля для individual через
            // .strict()-variant (`createIndividualVariant`). buildCreateRequestFromDraft
            // має відсікти taxation з payload-у незалежно від stale draft state.
            act(() => {
                useBusinessWizardStore.setState({
                    currentStep: 'purpose-banks',
                    formData: {
                        type: 'individual',
                        name: 'Іваненко',
                        requisites: { iban: VALID_IBAN, taxId: VALID_RNOKPP },
                        // Stale taxation з попереднього вибору fop-у — defensive
                        // не повинно потрапити у submit.
                        taxationSystem: undefined,
                        isVatPayer: undefined,
                        paymentPurposeTemplate: 'На пицу',
                        acceptedBanks: [...MVP_BANKS],
                    },
                });
            });
            mockCreateBusiness.mockResolvedValue({
                slug: 'individual1',
                id: '507f1f77bcf86cd799439012',
            });

            render(<BusinessWizardForm />);
            fireEvent.click(screen.getByRole('button', { name: /створити/i }));

            await waitFor(() =>
                expect(mockCreateBusiness).toHaveBeenCalledTimes(1),
            );
            const payload = mockCreateBusiness.mock.calls[0]![0];
            expect(payload.type).toBe('individual');
            expect(payload).not.toHaveProperty('taxationSystem');
            expect(payload).not.toHaveProperty('isVatPayer');
        });

        it("organization submit з ЄДРПОУ (8-digit), без taxation-полів", async () => {
            act(() => {
                useBusinessWizardStore.setState({
                    currentStep: 'purpose-banks',
                    formData: {
                        type: 'organization',
                        name: 'ОСББ Покрова',
                        requisites: { iban: VALID_IBAN, taxId: VALID_EDRPOU },
                        paymentPurposeTemplate: 'Внесок на ОСББ',
                        acceptedBanks: [...MVP_BANKS],
                    },
                });
            });
            mockCreateBusiness.mockResolvedValue({
                slug: 'pokrova',
                id: '507f1f77bcf86cd799439013',
            });

            render(<BusinessWizardForm />);
            fireEvent.click(screen.getByRole('button', { name: /створити/i }));

            await waitFor(() =>
                expect(mockCreateBusiness).toHaveBeenCalledTimes(1),
            );
            const payload = mockCreateBusiness.mock.calls[0]![0];
            expect(payload.type).toBe('organization');
            expect(payload.requisites.taxId).toBe(VALID_EDRPOU);
            expect(payload).not.toHaveProperty('taxationSystem');
        });

        it('reset wizard store після successful submit', async () => {
            act(() => {
                useBusinessWizardStore.setState({
                    currentStep: 'purpose-banks',
                    formData: {
                        type: 'fop',
                        name: 'Іваненко',
                        requisites: { iban: VALID_IBAN, taxId: VALID_RNOKPP },
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

            await waitFor(() => expect(mockRouterReplace).toHaveBeenCalled());
            expect(useBusinessWizardStore.getState().currentStep).toBe(
                'type-name',
            );
            expect(
                useBusinessWizardStore.getState().formData.name,
            ).toBeUndefined();
        });

        it("reset wizard на 'type-name' + toast.error при stale formData", async () => {
            act(() => {
                useBusinessWizardStore.setState({
                    currentStep: 'purpose-banks',
                    formData: {
                        type: 'fop',
                        name: 'Іваненко',
                        // requisites відсутні → CreateBusinessSchema fail
                        taxationSystem: 'simplified-3',
                        isVatPayer: false,
                        acceptedBanks: [...MVP_BANKS],
                    },
                });
            });

            render(<BusinessWizardForm />);
            const purpose = screen.getByPlaceholderText(/оплата за послуги/i);
            fireEvent.change(purpose, { target: { value: 'Оплата' } });

            const createButton = screen.getByRole('button', {
                name: /створити/i,
            });
            await waitFor(() => expect(createButton).not.toBeDisabled());
            fireEvent.click(createButton);

            await waitFor(() => expect(mockToastError).toHaveBeenCalled());
            expect(mockCreateBusiness).not.toHaveBeenCalled();
            expect(useBusinessWizardStore.getState().currentStep).toBe(
                'type-name',
            );
        });
    });

    describe('StepNavigator — Sprint 7 §SP-6 dynamic step-count', () => {
        it("individual — mobile-індикатор 'Крок 1 з 3'", () => {
            act(() => {
                useBusinessWizardStore.setState({
                    currentStep: 'type-name',
                    formData: {
                        type: 'individual',
                        acceptedBanks: [...MVP_BANKS],
                    },
                });
            });

            render(<BusinessWizardForm />);
            expect(screen.getByText(/Крок 1 з 3/)).toBeInTheDocument();
        });

        it("fop — mobile-індикатор 'Крок 1 з 4'", () => {
            act(() => {
                useBusinessWizardStore.setState({
                    currentStep: 'type-name',
                    formData: {
                        type: 'fop',
                        acceptedBanks: [...MVP_BANKS],
                    },
                });
            });

            render(<BusinessWizardForm />);
            expect(screen.getByText(/Крок 1 з 4/)).toBeInTheDocument();
        });
    });
});
