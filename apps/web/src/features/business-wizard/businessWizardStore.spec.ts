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

    it('initial formData — type undefined, всі банки з MVP_BANKS (Sprint 9 §9.0 — 10 банків після SportBank-консолідації)', () => {
        const data = useBusinessWizardStore.getState().formData;
        expect(data.type).toBeUndefined();
        expect(data.taxationSystem).toBeUndefined();
        expect(data.isVatPayer).toBeUndefined();
        expect(data.acceptedBanks).toHaveLength(10);
    });

    it('setStep змінює currentStep на named-літерал', () => {
        useBusinessWizardStore.getState().setStep('taxation');
        expect(useBusinessWizardStore.getState().currentStep).toBe('taxation');
    });

    it('patchFormData merge-ує partial у formData без втрати інших полів', () => {
        const { patchFormData, setType } = useBusinessWizardStore.getState();
        setType('fop');
        patchFormData({ name: 'Іваненко' });
        patchFormData({ taxId: '1234567899' });
        const data = useBusinessWizardStore.getState().formData;
        expect(data.name).toBe('Іваненко');
        // Sprint 9 §9.2 — taxId flatten з requisites.taxId → top-level.
        expect(data.taxId).toBe('1234567899');
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

        it('v3 persist (named currentStep + top-level taxId) — passthrough', async () => {
            sessionStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    state: {
                        currentStep: 'taxation',
                        formData: {
                            type: 'fop',
                            name: 'Іваненко',
                            taxId: '1234567899',
                        },
                    },
                    version: 3,
                })
            );
            await useBusinessWizardStore.persist.rehydrate();
            const s = useBusinessWizardStore.getState();
            expect(s.currentStep).toBe('taxation');
            expect(s.formData.taxId).toBe('1234567899');
        });
    });

    // ─── Sprint 9 §9.2 — persist migration v2→v3 (requisites flatten) ───

    describe('persist migration v2→v3 (requisites.taxId → taxId, drop iban + invoiceSlugPresetDefault)', () => {
        const STORAGE_KEY = 'finly:business-wizard';

        beforeEach(() => {
            sessionStorage.clear();
        });

        it('v2 з requisites.taxId → flatten у top-level taxId; requisites.iban drop-ається; invoiceSlugPresetDefault drop-ається', async () => {
            sessionStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    state: {
                        currentStep: 'taxation',
                        formData: {
                            type: 'fop',
                            name: 'Іваненко',
                            requisites: {
                                iban: 'UA213223130000026007233566001',
                                taxId: '1234567899',
                            },
                            invoiceSlugPresetDefault: 'with-month',
                        },
                    },
                    version: 2,
                })
            );
            await useBusinessWizardStore.persist.rehydrate();
            const data = useBusinessWizardStore.getState().formData;
            expect(data.taxId).toBe('1234567899');
            // iban i invoiceSlugPresetDefault — поза новою shape.
            expect((data as Record<string, unknown>).iban).toBeUndefined();
            expect(
                (data as Record<string, unknown>).requisites
            ).toBeUndefined();
            expect(
                (data as Record<string, unknown>).invoiceSlugPresetDefault
            ).toBeUndefined();
            // Не-зачеплені поля проходять без змін.
            expect(data.type).toBe('fop');
            expect(data.name).toBe('Іваненко');
        });

        it('v2 без requisites — formData без taxId (юзер ще не дійшов до Step 2)', async () => {
            sessionStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    state: {
                        currentStep: 'type-name',
                        formData: { type: 'individual', name: 'Партія' },
                    },
                    version: 2,
                })
            );
            await useBusinessWizardStore.persist.rehydrate();
            const data = useBusinessWizardStore.getState().formData;
            expect(data.taxId).toBeUndefined();
            expect(data.type).toBe('individual');
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

        it('переключення fop → tov ЗБЕРІГАЄ taxation-fields, якщо система дозволена для tov (simplified-3 ∈ allowed)', () => {
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

        it.each(['simplified-1', 'simplified-2'] as const)(
            'переключення fop+%s → tov СКИДАЄ taxation-fields (ПКУ — групи 1/2 заборонені для ТОВ)',
            (taxationSystem) => {
                const { setType, patchFormData } =
                    useBusinessWizardStore.getState();
                setType('fop');
                patchFormData({
                    taxationSystem,
                    isVatPayer: false,
                });
                setType('tov');
                const data = useBusinessWizardStore.getState().formData;
                expect(data.type).toBe('tov');
                // Без reset користувач застряг би у Step3 з невалідним store-
                // стейтом — dropdown відфільтрував би option, але `formData.
                // taxationSystem` лишився б defined, canProceed пройшов би,
                // а submit упав на backend Zod-refine.
                expect(data.taxationSystem).toBeUndefined();
                expect(data.isVatPayer).toBeUndefined();
            }
        );

        it('переключення tov → fop ЗБЕРІГАЄ taxation-fields (всі ТОВ-системи валідні і для ФОП)', () => {
            const { setType, patchFormData } =
                useBusinessWizardStore.getState();
            setType('tov');
            patchFormData({
                taxationSystem: 'general',
                isVatPayer: true,
            });
            setType('fop');
            const data = useBusinessWizardStore.getState().formData;
            expect(data.type).toBe('fop');
            expect(data.taxationSystem).toBe('general');
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

        // ─── taxId reset на несумісний формат ───
        //
        // Якщо користувач уже ввів taxId на Step 'requisites' і повертається
        // на Step 'type-name' змінити тип — store мусить скинути значення,
        // якщо validator нового типу його reject-ить. Інакше Step2 на
        // re-mount хапає старе значення як defaultValues, RHF reject-ить,
        // кнопка "Далі" disabled поки користувач не зітре зайве вручну.

        it.each([
            ['fop', 'tov'],
            ['fop', 'organization'],
            ['individual', 'tov'],
            ['individual', 'organization'],
        ] as const)(
            'переключення %s (10-digit РНОКПП) → %s СКИДАЄ taxId (формат 8-digit ЄДРПОУ)',
            (fromType, toType) => {
                const { setType, patchFormData } =
                    useBusinessWizardStore.getState();
                setType(fromType);
                patchFormData({ taxId: '1234567899' });
                setType(toType);
                const data = useBusinessWizardStore.getState().formData;
                expect(data.type).toBe(toType);
                expect(data.taxId).toBeUndefined();
            }
        );

        it.each([
            ['tov', 'fop'],
            ['tov', 'individual'],
            ['organization', 'fop'],
            ['organization', 'individual'],
        ] as const)(
            'переключення %s (8-digit ЄДРПОУ) → %s СКИДАЄ taxId (формат 10-digit РНОКПП)',
            (fromType, toType) => {
                const { setType, patchFormData } =
                    useBusinessWizardStore.getState();
                setType(fromType);
                patchFormData({ taxId: '12345678' });
                setType(toType);
                const data = useBusinessWizardStore.getState().formData;
                expect(data.type).toBe(toType);
                expect(data.taxId).toBeUndefined();
            }
        );

        it.each([
            ['fop', 'individual'],
            ['individual', 'fop'],
        ] as const)(
            'переключення %s ↔ %s ЗБЕРІГАЄ taxId (обидва формат 10-digit РНОКПП)',
            (fromType, toType) => {
                const { setType, patchFormData } =
                    useBusinessWizardStore.getState();
                setType(fromType);
                patchFormData({ taxId: '1234567899' });
                setType(toType);
                expect(useBusinessWizardStore.getState().formData.taxId).toBe(
                    '1234567899'
                );
            }
        );

        it.each([
            ['tov', 'organization'],
            ['organization', 'tov'],
        ] as const)(
            'переключення %s ↔ %s ЗБЕРІГАЄ taxId (обидва формат 8-digit ЄДРПОУ)',
            (fromType, toType) => {
                const { setType, patchFormData } =
                    useBusinessWizardStore.getState();
                setType(fromType);
                patchFormData({ taxId: '12345678' });
                setType(toType);
                expect(useBusinessWizardStore.getState().formData.taxId).toBe(
                    '12345678'
                );
            }
        );

        it('переключення типу без введеного taxId — passthrough (нема що скидати)', () => {
            const { setType } = useBusinessWizardStore.getState();
            setType('fop');
            setType('tov');
            expect(
                useBusinessWizardStore.getState().formData.taxId
            ).toBeUndefined();
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
