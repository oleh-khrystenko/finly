'use client';

import type { PayerSource, PayerView, UserProfile } from '@finly/types';
import { formatPayerFullName } from '@finly/types';
import UiSelect from '@/shared/ui/UiSelect';
import { formatPayeeName } from '@/entities/business';

/** Значення підстановки, які вміє дати обраний платник. */
export interface PayerValues {
    fullName: string;
    taxId: string;
}

export const MANUAL_SELECTION = 'manual';
export const SELF_SELECTION = 'me';

/**
 * Ключі опцій з різних джерел живуть в одному просторі імен `UiSelect`, тому
 * ідентифікатори записів префіксуються за джерелом. Голий ідентифікатор
 * поставив би збіг ключів платника і отримувача в залежність від того, що дві
 * різні колекції ніколи не видадуть однаковий `ObjectId` — припущення, ціна
 * помилки якого тут дорівнює платежу за не ту людину.
 */
export const payerOptionKey = (id: string) => `payer:${id}`;
const sourceOptionKey = (id: string) => `source:${id}`;

export interface PayerOption {
    key: string;
    label: string;
    /** `null` — ручний ввід: опція нічого не заміщає у полях. */
    values: PayerValues | null;
    /** Опція описує самого користувача, а не його клієнта. */
    isSelf: boolean;
}

/**
 * Власні дані користувача з профілю. Податкового номера тут немає і бути не
 * може: він живе на отримувачі-фізособі, а профіль знає лише ПІБ. Порожній
 * номер заміщає поле саме порожнім — інакше після вибору «Я» у ньому лишився б
 * номер попередньо обраного клієнта під власним ПІБ.
 */
export function selfPayerValues(user: UserProfile): PayerValues {
    return {
        fullName: formatPayerFullName(
            user.profile.lastName,
            user.profile.firstName,
            user.profile.middleName
        ),
        taxId: '',
    };
}

function sourceOption(source: PayerSource): PayerOption {
    const displayName = formatPayeeName(source.type, source.name);
    return {
        key: sourceOptionKey(source.id),
        // Власний отримувач і є «я», тому підпис це проговорює: інакше бухгалтер
        // з десятком клієнтів шукав би себе серед однорідних рядків.
        label: source.isOwn
            ? `Я — ${displayName} — ${source.taxId}`
            : `${displayName} — ${source.taxId}`,
        // У призначення платежу їде «сира» назва без юр-форми: банк читає це
        // поле як ПІБ платника, а не як назву отримувача.
        values: { fullName: source.name, taxId: source.taxId },
        isSelf: source.isOwn,
    };
}

/**
 * Опції вибору з усіх джерел, які система вже знає: власні отримувачі-фізособи,
 * збережений список платників і клієнтські отримувачі бухгалтера. У ФОПа
 * `taxId` — це РНОКПП тієї самої людини, і він уже введений при створенні
 * отримувача, тож окремої копії номера у профілі не існує.
 *
 * **Профільна опція «Я» — фолбек, а не дубль.** Вона зʼявляється тільки коли
 * власних отримувачів немає: тоді підставляється хоча б ПІБ, а номер людина
 * вписує руками. Щойн зʼявляється власний отримувач, роль «я» переходить до
 * нього разом з номером.
 *
 * **Дедуплікація за податковим номером.** Той самий РНОКПП може прийти і зі
 * збереженого списку, і з отримувача; у переліку він мусить бути один раз.
 * Пріоритет за явністю запису: власний отримувач, далі збережений платник,
 * далі клієнтський отримувач — назвою отримувача може бути що завгодно
 * («Крамниця біля дому» замість ПІБ), а збережений платник заводився саме як
 * платник.
 *
 * Чиста функція, а не логіка всередині рендеру: порядок і склад опцій — те
 * єдине, що відрізняє правильний платіж від платежу за чужого клієнта, тож це
 * має перевірятись тестом без монтування сторінки.
 */
export function buildPayerOptions({
    user,
    payers,
    sources,
}: {
    user: UserProfile;
    payers: PayerView[];
    sources: PayerSource[];
}): PayerOption[] {
    const own = sources.filter((source) => source.isOwn);
    const claimedTaxIds = new Set(own.map((source) => source.taxId));

    const savedPayers: PayerOption[] = [];
    for (const payer of payers) {
        if (claimedTaxIds.has(payer.taxId)) continue;
        claimedTaxIds.add(payer.taxId);
        savedPayers.push({
            key: payerOptionKey(payer.id),
            label: `${payer.fullName} — ${payer.taxId}`,
            values: { fullName: payer.fullName, taxId: payer.taxId },
            isSelf: false,
        });
    }

    const clients: PayerOption[] = [];
    for (const source of sources) {
        if (source.isOwn || claimedTaxIds.has(source.taxId)) continue;
        claimedTaxIds.add(source.taxId);
        clients.push(sourceOption(source));
    }

    const self = selfPayerValues(user);
    const profileFallback: PayerOption[] =
        own.length > 0 || !self.fullName
            ? []
            : [
                  {
                      key: SELF_SELECTION,
                      label: `Я — ${self.fullName}`,
                      values: self,
                      isSelf: true,
                  },
              ];

    return [
        ...own.map(sourceOption),
        ...profileFallback,
        ...savedPayers,
        ...clients,
        {
            key: MANUAL_SELECTION,
            label: 'Ввести вручну',
            values: null,
            isSelf: false,
        },
    ];
}

/**
 * Опція для автопідстановки при відкритті сторінки — або однозначна, або її
 * немає. Однозначна це рівно один запис про саму людину: власний отримувач, а
 * за його відсутності профільний фолбек з ПІБ.
 *
 * Кілька власних отримувачів (фізособа плюс ФОП) — не привід вгадувати: у
 * призначення пішов би номер, якого людина не обирала, а помилка тут коштує
 * незарахованого податкового платежу. Тоді нічого не підставляємо, і вибір
 * лишається явним.
 */
export function autoPayerOption(options: PayerOption[]): PayerOption | null {
    const selves = options.filter((option) => option.isSelf);
    return selves.length === 1 ? selves[0]! : null;
}

interface Props {
    options: PayerOption[];
    value: string;
    onChange: (selection: string, values: PayerValues | null) => void;
}

/**
 * Вибір, за кого платимо: я, збережений платник, клієнт-отримувач або ручний
 * ввід. Вибір завжди явний, а підставлені значення лишаються редагованими:
 * помилка тут коштує незарахованого податкового платежу, тож останнє слово за
 * людиною, а не за системою.
 */
export default function PayerSelector({ options, value, onChange }: Props) {
    return (
        <UiSelect
            label="За кого платите"
            placeholder="Оберіть платника"
            options={options.map((option) => ({
                label: option.label,
                value: option.key,
            }))}
            value={value}
            onChange={(selection) => {
                const option = options.find((o) => o.key === selection);
                // Опція, якої немає у списку, не може підставити значення — але
                // й мовчки лишати попередній вибір не можна: підпис розійшовся б
                // з тим, що у полях.
                onChange(selection, option?.values ?? null);
            }}
        />
    );
}
