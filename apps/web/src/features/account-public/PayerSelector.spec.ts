import type { PayerSource, PayerView, UserProfile } from '@finly/types';

import {
    MANUAL_SELECTION,
    SELF_SELECTION,
    autoPayerOption,
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
    },
};

const payer = (taxId: string, fullName: string): PayerView => ({
    id: 'payer-1',
    fullName,
    taxId,
    createdAt: new Date(),
    updatedAt: new Date(),
});

const source = (
    id: string,
    taxId: string,
    name: string,
    isOwn: boolean
): PayerSource => ({ id, type: 'fop', name, taxId, isOwn });

describe('buildPayerOptions', () => {
    it('власний отримувач іде першим і підписаний як «я»', () => {
        const options = buildPayerOptions({
            user,
            payers: [],
            sources: [
                source('client-1', CLIENT_TAX_ID, 'Петренко Іван', false),
                source('own-1', OWN_TAX_ID, 'Ковальчук Олена', true),
            ],
        });

        expect(options[0]!.label).toBe(
            `Я — ФОП Ковальчук Олена — ${OWN_TAX_ID}`
        );
        expect(options[0]!.isSelf).toBe(true);
        // Профільний фолбек не зʼявляється: роль «я» вже несе отримувач разом
        // з податковим номером, і друга опція про ту саму людину без номера
        // була б пасткою.
        expect(options.map((o) => o.key)).not.toContain(SELF_SELECTION);
    });

    it('без власних отримувачів дає профільний фолбек з ПІБ і порожнім номером', () => {
        const options = buildPayerOptions({ user, payers: [], sources: [] });

        expect(options[0]).toMatchObject({
            key: SELF_SELECTION,
            label: 'Я — Ковальчук Олена Петрівна',
            values: { fullName: 'Ковальчук Олена Петрівна', taxId: '' },
            isSelf: true,
        });
        expect(options[1]!.key).toBe(MANUAL_SELECTION);
    });

    it('порядок: свої → збережені платники → клієнти → вручну', () => {
        const options = buildPayerOptions({
            user,
            payers: [payer(CLIENT_TAX_ID, 'Петренко Іван Іванович')],
            sources: [
                source('client-1', '2222222222', 'Шевченко Тарас', false),
                source('own-1', OWN_TAX_ID, 'Ковальчук Олена', true),
            ],
        });

        expect(options.map((o) => o.key)).toEqual([
            'source:own-1',
            'payer:payer-1',
            'source:client-1',
            MANUAL_SELECTION,
        ]);
    });

    it('клієнт з уже збереженим номером не задвоює запис', () => {
        // Той самий клієнт може бути і збереженим платником, і отримувачем
        // бухгалтера. Перемагає збережений запис: його ПІБ людина вводила саме
        // як імʼя платника, тоді як назвою отримувача може бути що завгодно.
        const options = buildPayerOptions({
            user,
            payers: [payer(CLIENT_TAX_ID, 'Петренко Іван Іванович')],
            sources: [
                source('client-1', CLIENT_TAX_ID, 'Крамниця біля дому', false),
            ],
        });

        expect(options.map((o) => o.key)).not.toContain('source:client-1');
        expect(options.find((o) => o.key === 'payer:payer-1')?.values).toEqual({
            fullName: 'Петренко Іван Іванович',
            taxId: CLIENT_TAX_ID,
        });
    });

    it('у значення підстановки йде назва без юр-форми, а у підпис — з нею', () => {
        const [option] = buildPayerOptions({
            user,
            payers: [],
            sources: [
                source('own-1', OWN_TAX_ID, 'Ковальчук Олена Петрівна', true),
            ],
        });

        expect(option!.values).toEqual({
            fullName: 'Ковальчук Олена Петрівна',
            taxId: OWN_TAX_ID,
        });
    });
});

describe('autoPayerOption', () => {
    it('єдиний власний запис підставляється сам', () => {
        const options = buildPayerOptions({
            user,
            payers: [payer(CLIENT_TAX_ID, 'Петренко Іван')],
            sources: [source('own-1', OWN_TAX_ID, 'Ковальчук Олена', true)],
        });

        expect(autoPayerOption(options)?.key).toBe('source:own-1');
    });

    it('кілька власних отримувачів — не вгадуємо', () => {
        // Фізособа плюс ФОП: підставити один означало б покласти у призначення
        // номер, якого людина не обирала.
        const options = buildPayerOptions({
            user,
            payers: [],
            sources: [
                source('own-1', OWN_TAX_ID, 'Ковальчук Олена', true),
                source('own-2', '2222222222', 'Ковальчук О. П.', true),
            ],
        });

        expect(autoPayerOption(options)).toBeNull();
    });

    it('без власних записів підставляється профільний фолбек', () => {
        const options = buildPayerOptions({ user, payers: [], sources: [] });

        expect(autoPayerOption(options)?.key).toBe(SELF_SELECTION);
    });
});
