'use client';

import {
    BANK_LABEL,
    accountNameSchema,
    type Account,
} from '@finly/types';
import UiInput from '@/shared/ui/UiInput';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiEditableField from '@/shared/ui/UiEditableField';
import { mapValidationCode } from '@/shared/lib';

interface Props {
    account: Account;
    onSave: (patch: Partial<Pick<Account, 'name'>>) => Promise<void>;
}

/**
 * Sprint 9 §9.2 — секція "Основне" на account-cabinet-page. Inline-edit
 * `name` + readonly `bankCode`-label (resolved з МФО при create, §SP-9
 * stored derived value).
 *
 * **Null-bankCode fallback (§SP-9, 4-UI-точок invariant):** на
 * `bankCode === null` bank-label-row ховається повністю — без fallback-у на
 * "Невідомий банк". Інша точка — IBAN-mask `•{last4}`, що рендериться у
 * `IbanSection` як disambiguator.
 */
export default function BasicSection({ account, onSave }: Props) {
    return (
        <UiSectionCard title="Основне">
            <div className="space-y-4">
                {account.bankCode !== null && (
                    <div>
                        <p className="text-muted-foreground text-xs font-medium">
                            Банк
                        </p>
                        <p className="text-foreground mt-1 text-sm">
                            {BANK_LABEL[account.bankCode]}
                        </p>
                    </div>
                )}
                <UiEditableField<string>
                    label="Назва"
                    value={account.name}
                    renderRead={(v) => v}
                    renderEdit={({ value, setValue, error }) => (
                        <UiInput
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            error={error}
                            maxLength={60}
                        />
                    )}
                    validate={(v) => {
                        const r = accountNameSchema.safeParse(v);
                        return r.success
                            ? null
                            : (mapValidationCode(r.error.issues[0]?.message) ??
                                  null);
                    }}
                    onSave={(v) => onSave({ name: v })}
                />
            </div>
        </UiSectionCard>
    );
}
