import {
    VAT_CHOICE_SECTION_LABEL,
    getVatChoiceOptions,
    isVatChoiceApplicable,
    vatBoolToChoice,
    vatChoiceToBool,
} from './vatChoiceOptions';

describe('vatChoiceOptions', () => {
    describe('bool ↔ choice round-trip', () => {
        it('vatBoolToChoice', () => {
            expect(vatBoolToChoice(true)).toBe('yes');
            expect(vatBoolToChoice(false)).toBe('no');
        });

        it('vatChoiceToBool', () => {
            expect(vatChoiceToBool('yes')).toBe(true);
            expect(vatChoiceToBool('no')).toBe(false);
        });

        it.each([true, false])('round-trip %s', (v) => {
            expect(vatChoiceToBool(vatBoolToChoice(v))).toBe(v);
        });
    });

    describe('isVatChoiceApplicable type-guard', () => {
        it.each(['simplified-3', 'general'])(
            '%s — applicable (ПДВ юридично дозволений)',
            (system) => {
                expect(isVatChoiceApplicable(system)).toBe(true);
            }
        );

        it.each(['simplified-1', 'simplified-2'])(
            '%s — NOT applicable (ПКУ — ПДВ заборонений)',
            (system) => {
                expect(isVatChoiceApplicable(system)).toBe(false);
            }
        );

        it('undefined — NOT applicable (тип ще не обраний)', () => {
            expect(isVatChoiceApplicable(undefined)).toBe(false);
        });
    });

    describe('getVatChoiceOptions — system-specific semantics', () => {
        it('simplified-3 — про вибір ставки ЄП (5% vs 3% + ПДВ)', () => {
            const options = getVatChoiceOptions('simplified-3');
            expect(options).toHaveLength(2);
            // ст. 293.3 ПКУ — ставки 3% (з ПДВ) і 5% (без ПДВ)
            expect(options[0]!.value).toBe('no');
            expect(options[0]!.title).toBe('Ставка 5% без ПДВ');
            expect(options[1]!.value).toBe('yes');
            expect(options[1]!.title).toBe('Ставка 3% + ПДВ');
        });

        it('general — про факт реєстрації у податковій', () => {
            const options = getVatChoiceOptions('general');
            expect(options).toHaveLength(2);
            // ст. 181 ПКУ — обовʼязкова реєстрація з 1 млн грн обороту
            expect(options[0]!.value).toBe('no');
            expect(options[0]!.title).toBe('Не зареєстрований');
            expect(options[1]!.value).toBe('yes');
            expect(options[1]!.title).toBe('Зареєстрований платник ПДВ');
        });

        it.each(['simplified-3', 'general'] as const)(
            '%s — кожна опція має description (контекст для рішення)',
            (system) => {
                const options = getVatChoiceOptions(system);
                for (const opt of options) {
                    expect(opt.description).toBeDefined();
                    expect(typeof opt.description).toBe('string');
                    expect((opt.description as string).length).toBeGreaterThan(0);
                }
            }
        );
    });

    describe('VAT_CHOICE_SECTION_LABEL — заголовок секції різний за системою', () => {
        it('simplified-3 — про спосіб сплати ПДВ', () => {
            expect(VAT_CHOICE_SECTION_LABEL['simplified-3']).toBe(
                'Як ви платите ПДВ?'
            );
        });

        it('general — про факт реєстрації', () => {
            expect(VAT_CHOICE_SECTION_LABEL.general).toBe(
                'Реєстрація платником ПДВ'
            );
        });
    });
});
