import type { PayerSource, PayerView, UserProfile } from '@finly/types';

import {
    MANUAL_SELECTION,
    SELF_SELECTION,
    buildPayerOptions,
} from './PayerSelector';

/** Валідні РНОКПП (контрольна сума сходиться). */
const OWN_TAX_ID = '3182710695';
const CLIENT_TAX_ID = '3182710608';

const user: UserProfile = {
    id: '507f1f77bcf86cd799439011',
    email: 'buh@test.dev',
    role: 'user',
    worksAsBookkeeper: true,
    hasPassword: true,
    profile: {
        firstName: 'Олена',
        lastName: 'Ковальчук',
        middleName: 'Петрівна',
        taxId: OWN_TAX_ID,
    },
};

const payer = (taxId: string, fullName: string): PayerView => ({
    id: 'payer-1',
    fullName,
    taxId,
    createdAt: new Date(),
    updatedAt: new Date(),
});

const source = (taxId: string, name: string): PayerSource => ({
    id: 'business-1',
    type: 'fop',
    name,
    taxId,
});

describe('buildPayerOptions (Sprint 30)', () => {
    it('складає список у порядку «я → збережені → отримувачі → вручну»', () => {
        const options = buildPayerOptions({
            user,
            payers: [payer(CLIENT_TAX_ID, 'Петренко Іван Іванович')],
            sources: [source('2222222222', 'Шевченко Тарас Григорович')],
        });

        expect(options.map((o) => o.key)).toEqual([
            SELF_SELECTION,
            'payer:payer-1',
            'source:business-1',
            MANUAL_SELECTION,
        ]);
    });

    it('отримувач з уже збереженим номером не задвоює запис', () => {
        // Той самий клієнт може бути і збереженим платником, і отримувачем
        // бухгалтера. Перемагає збережений запис: його ПІБ людина вводила саме
        // як ім'я платника, тоді як назвою отримувача може бути що завгодно.
        const options = buildPayerOptions({
            user,
            payers: [payer(CLIENT_TAX_ID, 'Петренко Іван Іванович')],
            sources: [source(CLIENT_TAX_ID, 'Крамниця біля дому')],
        });

        expect(options.map((o) => o.key)).not.toContain('source:business-1');
        expect(options.find((o) => o.key === 'payer:payer-1')?.values).toEqual({
            fullName: 'Петренко Іван Іванович',
            taxId: CLIENT_TAX_ID,
        });
    });

    it('у значення підстановки йде назва без юр-форми, а у підпис — з нею', () => {
        const [, sourceOption] = buildPayerOptions({
            user,
            payers: [],
            sources: [source(CLIENT_TAX_ID, 'Петренко Іван Іванович')],
        });

        expect(sourceOption!.label).toBe(
            `ФОП Петренко Іван Іванович — ${CLIENT_TAX_ID}`
        );
        expect(sourceOption!.values).toEqual({
            fullName: 'Петренко Іван Іванович',
            taxId: CLIENT_TAX_ID,
        });
    });

    it('порожній власний РНОКПП не ховає отримувачів', () => {
        // Порожнє значення у профілі — не «зайнятий номер»: інакше перший же
        // незаповнений профіль вирізав би зі списку всіх отримувачів без
        // податкового номера в кеші.
        const options = buildPayerOptions({
            user: {
                ...user,
                profile: { ...user.profile, taxId: undefined },
            },
            payers: [],
            sources: [source(CLIENT_TAX_ID, 'Петренко Іван Іванович')],
        });

        expect(options.map((o) => o.key)).toContain('source:business-1');
    });
});
