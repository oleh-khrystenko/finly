import {
    computeStepsForType,
    isBusinessWizardStep,
    useBusinessWizardStore,
} from './businessWizardStore';

describe('useBusinessWizardStore', () => {
    beforeEach(() => {
        useBusinessWizardStore.getState().reset();
        sessionStorage.clear();
    });

    it("початковий currentStep = 'type-name'", () => {
        expect(useBusinessWizardStore.getState().currentStep).toBe('type-name');
    });

    it('initial formData — type undefined, всі 11 банків (Sprint 7 §SP-6)', () => {
        const data = useBusinessWizardStore.getState().formData;
        expect(data.type).toBeUndefined();
        expect(data.taxationSystem).toBeUndefined();
        expect(data.isVatPayer).toBeUndefined();
        expect(data.acceptedBanks).toHaveLength(11);
    });

    it('setStep змінює currentStep на named-літерал', () => {
        useBusinessWizardStore.getState().setStep('taxation');
        expect(useBusinessWizardStore.getState().currentStep).toBe('taxation');
    });

    it('patchFormData merge-ує partial у formData без втрати інших полів', () => {
        const { patchFormData, setType } = useBusinessWizardStore.getState();
        setType('fop');
        patchFormData({ name: 'Іваненко' });
        patchFormData({
            requisites: {
                iban: 'UA213223130000026007233566001',
                taxId: '1234567899',
            },
        });
        const data = useBusinessWizardStore.getState().formData;
        expect(data.name).toBe('Іваненко');
        expect(data.requisites?.iban).toBe('UA213223130000026007233566001');
        expect(data.type).toBe('fop'); // setType вище зафіксував
    });

    it("reset повертає до initial state ('type-name', type undefined)", () => {
        const { setStep, patchFormData, reset } =
            useBusinessWizardStore.getState();
        setStep('purpose-banks');
        patchFormData({ name: 'Test' });
        reset();
        const s = useBusinessWizardStore.getState();
        expect(s.currentStep).toBe('type-name');
        expect(s.formData.name).toBeUndefined();
        expect(s.formData.type).toBeUndefined();
    });

    // ─── Sprint 7 §SP-6 — computeStepsForType ───

    describe('computeStepsForType', () => {
        it('fop / tov → 4 кроки з taxation', () => {
            for (const type of ['fop', 'tov'] as const) {
                expect(computeStepsForType(type)).toEqual([
                    'type-name',
                    'requisites',
                    'taxation',
                    'purpose-banks',
                ]);
            }
        });

        it('individual / organization → 3 кроки без taxation', () => {
            for (const type of ['individual', 'organization'] as const) {
                expect(computeStepsForType(type)).toEqual([
                    'type-name',
                    'requisites',
                    'purpose-banks',
                ]);
            }
        });

        it('undefined (тип ще не обраний) → fallback на повний 4-крок-list', () => {
            // До вибору типу wizard на Step 'type-name'; всі shapes
            // починаються однаково. Якщо повертати лише ['type-name'] —
            // StepNavigator показав би "Крок 1 з 1", що дезінформує
            // користувача про обсяг wizard-у.
            expect(computeStepsForType(undefined)).toHaveLength(4);
        });

        it('повертає stable reference для того самого type (для useMemo-стабільності)', () => {
            // Кожен виклик з тим самим аргументом повертає той самий tuple
            // — дозволяє безпечно покладатися на reference-equality у
            // React-залежностях (наприклад, BusinessWizardForm useMemo).
            expect(computeStepsForType('fop')).toBe(computeStepsForType('tov'));
            expect(computeStepsForType('individual')).toBe(
                computeStepsForType('organization')
            );
        });
    });

    // ─── Sprint 7 §SP-6 — type-guard для persist migration ───

    describe('isBusinessWizardStep type-guard', () => {
        it('приймає всі 4 named-step літерали', () => {
            for (const step of [
                'type-name',
                'requisites',
                'taxation',
                'purpose-banks',
            ]) {
                expect(isBusinessWizardStep(step)).toBe(true);
            }
        });

        it('відхиляє numeric (старий Sprint 3 формат)', () => {
            for (const numeric of [1, 2, 3, 4]) {
                expect(isBusinessWizardStep(numeric)).toBe(false);
            }
        });

        it('відхиляє довільні строки і non-string значення', () => {
            for (const v of ['unknown-step', '', undefined, null, {}, []]) {
                expect(isBusinessWizardStep(v)).toBe(false);
            }
        });
    });

    // ─── Sprint 7 §SP-6 — persist migration v1→v2 ───
    //
    // BusinessWizardStore тепер persist-version: 2. Старі sessionStorage
    // entries (з Sprint 3-) мають numeric `currentStep`. Тести нижче
    // симулюють pre-existing tab-сесію через manual sessionStorage write
    // **до** першого імпорту/init-у store-а та перевіряють, що migrate
    // спрацював на rehydrate.
    //
    // Чому через `sessionStorage.setItem` напряму — нам треба обійти zustand
    // store-API і покласти legacy-shape state до того, як create() мікс-ить
    // actions. `useBusinessWizardStore.persist.rehydrate()` примусово ре-
    // запустить hydration з migrate-flow (Sprint 3 zustand 5.x API).

    describe('persist migration v1→v2 (numeric → named currentStep)', () => {
        const STORAGE_KEY = 'finly:business-wizard';

        beforeEach(() => {
            sessionStorage.clear();
        });

        it.each([
            [1, 'type-name'],
            [2, 'requisites'],
            [3, 'taxation'],
            [4, 'purpose-banks'],
        ] as const)(
            'numeric currentStep=%s (v1) мігрує на %s',
            async (numericStep, expectedNamed) => {
                // Pre-Sprint-7 persist shape: version: 0 (default), state з
                // numeric currentStep.
                sessionStorage.setItem(
                    STORAGE_KEY,
                    JSON.stringify({
                        state: {
                            currentStep: numericStep,
                            formData: {
                                type: 'fop',
                                name: 'Іваненко',
                                acceptedBanks: [],
                            },
                        },
                        version: 0,
                    })
                );

                // Force re-hydration з migrate-flow.
                await useBusinessWizardStore.persist.rehydrate();

                expect(useBusinessWizardStore.getState().currentStep).toBe(
                    expectedNamed
                );
                // Зберігається formData з legacy state — wizard продовжує
                // з місця, де користувач зупинився.
                expect(useBusinessWizardStore.getState().formData.name).toBe(
                    'Іваненко'
                );
            }
        );

        it('garbage currentStep (невалідний numeric / unknown string) → fallback type-name', async () => {
            sessionStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    state: { currentStep: 99, formData: { type: 'fop' } },
                    version: 0,
                })
            );
            await useBusinessWizardStore.persist.rehydrate();
            expect(useBusinessWizardStore.getState().currentStep).toBe(
                'type-name'
            );
        });

        it('vNext persist (named currentStep вже валідний) — passthrough без змін', async () => {
            sessionStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    state: {
                        currentStep: 'taxation',
                        formData: { type: 'fop', name: 'Іваненко' },
                    },
                    version: 2,
                })
            );
            await useBusinessWizardStore.persist.rehydrate();
            expect(useBusinessWizardStore.getState().currentStep).toBe(
                'taxation'
            );
        });
    });

    // ─── Sprint 7 §SP-6 — setType reset semantics ───

    describe('setType', () => {
        it('встановлює type, taxation-fields лишаються undefined для individual', () => {
            useBusinessWizardStore.getState().setType('individual');
            const data = useBusinessWizardStore.getState().formData;
            expect(data.type).toBe('individual');
            expect(data.taxationSystem).toBeUndefined();
            expect(data.isVatPayer).toBeUndefined();
        });

        it('переключення fop → individual очищає taxation-fields', () => {
            const { setType, patchFormData } =
                useBusinessWizardStore.getState();
            setType('fop');
            patchFormData({
                taxationSystem: 'simplified-3',
                isVatPayer: true,
            });
            // Користувач повертається на Step 1 і змінює тип — wizard
            // не повинен залишити garbage taxation у submit-payload-і.
            setType('individual');
            const data = useBusinessWizardStore.getState().formData;
            expect(data.type).toBe('individual');
            expect(data.taxationSystem).toBeUndefined();
            expect(data.isVatPayer).toBeUndefined();
        });

        it('переключення tov → organization очищає taxation-fields', () => {
            const { setType, patchFormData } =
                useBusinessWizardStore.getState();
            setType('tov');
            patchFormData({
                taxationSystem: 'general',
                isVatPayer: true,
            });
            setType('organization');
            const data = useBusinessWizardStore.getState().formData;
            expect(data.type).toBe('organization');
            expect(data.taxationSystem).toBeUndefined();
            expect(data.isVatPayer).toBeUndefined();
        });

        it('переключення fop → tov ЗБЕРІГАЄ taxation-fields (обидва вимагають)', () => {
            const { setType, patchFormData } =
                useBusinessWizardStore.getState();
            setType('fop');
            patchFormData({
                taxationSystem: 'simplified-3',
                isVatPayer: true,
            });
            setType('tov');
            const data = useBusinessWizardStore.getState().formData;
            expect(data.type).toBe('tov');
            expect(data.taxationSystem).toBe('simplified-3');
            expect(data.isVatPayer).toBe(true);
        });

        it('переключення individual → fop НЕ встановлює taxation (юзер заповнить на Step taxation)', () => {
            const { setType } = useBusinessWizardStore.getState();
            setType('individual');
            setType('fop');
            const data = useBusinessWizardStore.getState().formData;
            expect(data.type).toBe('fop');
            expect(data.taxationSystem).toBeUndefined();
            expect(data.isVatPayer).toBeUndefined();
        });
    });

    // ─── Sprint 7 §SP-6 — nextStep / prevStep через computed steps ───

    describe('nextStep / prevStep', () => {
        it('fop: type-name → requisites → taxation → purpose-banks', () => {
            const { setType, nextStep } = useBusinessWizardStore.getState();
            setType('fop');
            expect(useBusinessWizardStore.getState().currentStep).toBe(
                'type-name'
            );
            nextStep();
            expect(useBusinessWizardStore.getState().currentStep).toBe(
                'requisites'
            );
            nextStep();
            expect(useBusinessWizardStore.getState().currentStep).toBe(
                'taxation'
            );
            nextStep();
            expect(useBusinessWizardStore.getState().currentStep).toBe(
                'purpose-banks'
            );
            // Final step: nextStep — no-op
            nextStep();
            expect(useBusinessWizardStore.getState().currentStep).toBe(
                'purpose-banks'
            );
        });

        it("individual: type-name → requisites → purpose-banks (skip 'taxation')", () => {
            const { setType, nextStep } = useBusinessWizardStore.getState();
            setType('individual');
            nextStep();
            expect(useBusinessWizardStore.getState().currentStep).toBe(
                'requisites'
            );
            nextStep();
            // Очікуємо, що skip перейде одразу на purpose-banks
            expect(useBusinessWizardStore.getState().currentStep).toBe(
                'purpose-banks'
            );
        });

        it('organization: 3-крокова навігація, taxation скіпається', () => {
            const { setType, nextStep, prevStep } =
                useBusinessWizardStore.getState();
            setType('organization');
            nextStep(); // → requisites
            nextStep(); // → purpose-banks (skip taxation)
            expect(useBusinessWizardStore.getState().currentStep).toBe(
                'purpose-banks'
            );
            prevStep(); // → requisites (без taxation у history)
            expect(useBusinessWizardStore.getState().currentStep).toBe(
                'requisites'
            );
            prevStep(); // → type-name
            expect(useBusinessWizardStore.getState().currentStep).toBe(
                'type-name'
            );
            // Перший step — prevStep no-op
            prevStep();
            expect(useBusinessWizardStore.getState().currentStep).toBe(
                'type-name'
            );
        });

        it('зміна типу під час wizard-у: setType(individual) на step taxation → currentStep лишається type-name після manual reset', () => {
            // Edge-case: користувач на Step 'taxation' після fop, повертається
            // на Step 1 і змінює тип на individual. computeStepsForType дає
            // 3-крок-list без 'taxation' — поточний `currentStep` тепер
            // irrelevant. nextStep має fallback'ити на 'purpose-banks'.
            const { setType, nextStep, setStep } =
                useBusinessWizardStore.getState();
            setType('fop');
            nextStep();
            nextStep();
            expect(useBusinessWizardStore.getState().currentStep).toBe(
                'taxation'
            );
            // Симулюємо jump-back на Step 1 + зміну типу
            setStep('type-name');
            setType('individual');
            // Стан: currentStep='type-name', steps=[type-name, requisites,
            // purpose-banks]. Це ОК, юзер просто йде через 3-крок-flow.
            expect(useBusinessWizardStore.getState().currentStep).toBe(
                'type-name'
            );
        });
    });
});
