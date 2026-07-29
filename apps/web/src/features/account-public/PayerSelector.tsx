'use client';

import type { PayerView, UserProfile } from '@finly/types';
import { formatPayerFullName } from '@finly/types';
import UiSelect from '@/shared/ui/UiSelect';

/** Значення підстановки, які вміє дати обраний платник. */
export interface PayerValues {
    fullName: string;
    taxId: string;
}

export const MANUAL_SELECTION = 'manual';
export const SELF_SELECTION = 'me';

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

interface Props {
    user: UserProfile;
    payers: PayerView[];
    value: string;
    onChange: (selection: string, values: PayerValues | null) => void;
}

/**
 * Sprint 30 — вибір, за кого платимо: я, конкретний платник зі списку або
 * ручний ввід. Вибір завжди явний, а підставлені значення лишаються
 * редагованими: помилка тут коштує незарахованого податкового платежу, тож
 * останнє слово за людиною, а не за системою.
 */
export default function PayerSelector({
    user,
    payers,
    value,
    onChange,
}: Props) {
    const self = selfPayerValues(user);
    const selfLabel = self.fullName ? `Я — ${self.fullName}` : 'Я';

    const options = [
        { label: selfLabel, value: SELF_SELECTION },
        ...payers.map((payer) => ({
            label: `${payer.fullName} — ${payer.taxId}`,
            value: payer.id,
        })),
        { label: 'Ввести вручну', value: MANUAL_SELECTION },
    ];

    return (
        <UiSelect
            label="За кого платите"
            placeholder="Оберіть платника"
            options={options}
            value={value}
            onChange={(selection) => {
                if (selection === MANUAL_SELECTION) {
                    onChange(selection, null);
                    return;
                }
                if (selection === SELF_SELECTION) {
                    onChange(selection, self);
                    return;
                }
                const payer = payers.find((p) => p.id === selection);
                onChange(
                    selection,
                    payer
                        ? { fullName: payer.fullName, taxId: payer.taxId }
                        : null
                );
            }}
        />
    );
}
