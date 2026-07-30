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
}

/**
 * Власні дані користувача як значення підстановки. Порожня частина (профіль без
 * по батькові чи без РНОКПП) повертається порожнім рядком — і саме порожнім
 * заміщає поле на сторінці: інакше після вибору «Я» там лишилось би значення
 * попередньо обраного клієнта. Решту людина дописує руками просто на сторінці.
 */
export function selfPayerValues(user: UserProfile): PayerValues {
    return {
        fullName: formatPayerFullName(
            user.profile.lastName,
            user.profile.firstName,
            user.profile.middleName
        ),
        taxId: user.profile.taxId ?? '',
    };
}

/**
 * Опції вибору з усіх джерел, які система вже знає: сам користувач, збережений
 * список платників і його ж отримувачі-фізособи (у ФОПа `taxId` — це РНОКПП
 * тієї самої людини, і він уже введений при створенні отримувача).
 *
 * **Дедуплікація за податковим номером.** Той самий РНОКПП може прийти і з
 * профілю, і зі списку, і з отримувача; у списку він мусить бути один раз.
 * Пріоритет — за явністю запису: профіль і збережений платник перемагають
 * отримувача, бо їх людина заводила саме як платника, тоді як назва отримувача
 * може бути чим завгодно («Магазин Ромашка» замість ПІБ).
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
    const self = selfPayerValues(user);
    const claimedTaxIds = new Set(
        [self.taxId, ...payers.map((payer) => payer.taxId)].filter(
            (taxId) => taxId.length > 0
        )
    );

    return [
        {
            key: SELF_SELECTION,
            label: self.fullName ? `Я — ${self.fullName}` : 'Я',
            values: self,
        },
        ...payers.map((payer) => ({
            key: payerOptionKey(payer.id),
            label: `${payer.fullName} — ${payer.taxId}`,
            values: { fullName: payer.fullName, taxId: payer.taxId },
        })),
        ...sources
            .filter((source) => !claimedTaxIds.has(source.taxId))
            .map((source) => ({
                key: sourceOptionKey(source.id),
                label: `${formatPayeeName(source.type, source.name)} — ${source.taxId}`,
                // У призначення платежу їде «сира» назва без юр-форми: банк
                // читає це поле як ПІБ платника, а не як назву отримувача.
                values: { fullName: source.name, taxId: source.taxId },
            })),
        { key: MANUAL_SELECTION, label: 'Ввести вручну', values: null },
    ];
}

interface Props {
    options: PayerOption[];
    value: string;
    onChange: (selection: string, values: PayerValues | null) => void;
}

/**
 * Sprint 30 — вибір, за кого платимо: я, збережений платник, власний отримувач
 * або ручний ввід. Вибір завжди явний, а підставлені значення лишаються
 * редагованими: помилка тут коштує незарахованого податкового платежу, тож
 * останнє слово за людиною, а не за системою.
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
