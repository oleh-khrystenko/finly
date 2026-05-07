'use client';

import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { type Invoice } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';
import UiSwitch from '@/shared/ui/UiSwitch';
import {
    formatKopecksForInput,
    mapValidationCode,
    parseUaMoney,
    type MoneyParseError,
} from '@/shared/lib';
import { formatKopecksAsHryvnia } from '@/entities/invoice';

interface Props {
    invoice: Invoice;
    onSave: (
        patch: Partial<Pick<Invoice, 'amount' | 'amountLocked'>>,
    ) => Promise<void>;
}

/**
 * Sprint 4 §4.6 — секція "Сума і блокування".
 *
 * **Inline-edit для двох полів:** amount + amountLocked. Coupled-rule
 * SP-6 enforced на UI: amount-edit-readonly якщо `amountLocked=true`
 * (inverted display). Через окрему секцію — для invoice-flow саме ці два
 * поля логічно групуються.
 *
 * **Окремий `MoneyEditableField`** (review fix), а не generic
 * `UiEditableField`, бо money-input має multi-stage state (raw string ↔
 * parsed kopecks ↔ format-error) — single boundary save-блокування на
 * parse-fail. Generic UiEditableField з render-prop-ом не давав робочого
 * способу reset raw на entering edit-mode чи cancel; крім того, save без
 * validate-callback пропускав stale-amount при invalid input — payment-
 * correctness ризик.
 */
export default function AmountSection({ invoice, onSave }: Props) {
    return (
        <UiSectionCard title="Сума і блокування">
            <div className="space-y-4">
                <MoneyEditableField
                    label="Сума"
                    value={invoice.amount}
                    onSave={(amount) => {
                        // SP-6 — auto-reset amountLocked при amount → null.
                        if (amount === null && invoice.amountLocked) {
                            return onSave({ amount, amountLocked: false });
                        }
                        return onSave({ amount });
                    }}
                />
                <label
                    htmlFor="invoice-amount-lock"
                    className={`border-border flex items-start justify-between gap-3 rounded-md border p-3 ${
                        invoice.amount === null
                            ? 'cursor-not-allowed opacity-60'
                            : 'cursor-pointer'
                    }`}
                >
                    <div className="flex flex-1 flex-col gap-1">
                        <span className="text-foreground text-sm font-medium">
                            Дозволити клієнту правити суму
                        </span>
                        <span className="text-muted-foreground text-xs">
                            {invoice.amount === null
                                ? 'Заблокувати можна лише при заданій сумі'
                                : 'Якщо вимкнено — клієнт сплатить точно зазначену суму'}
                        </span>
                    </div>
                    <UiSwitch
                        id="invoice-amount-lock"
                        checked={!invoice.amountLocked}
                        disabled={invoice.amount === null}
                        onChange={(allowEdit) => {
                            void onSave({ amountLocked: !allowEdit });
                        }}
                    />
                </label>
            </div>
        </UiSectionCard>
    );
}

/**
 * Money-aware inline-edit. Той самий read/edit/✓/✗ patern, що
 * `UiEditableField`, з трьома доданими інваріантами:
 *
 *  1. Raw string як single source of truth у edit-mode — `parseUaMoney`
 *     робить парс на кожному typing-event; UI бачить format-error live.
 *  2. **Save заблокований** на parse-error: `parseErr !== null` ⇒ `save()`
 *     no-op (повертається без виклику `onSave`). Це закриває payment-
 *     correctness регрес: раніше invalid input + click "Зберегти" зберігав
 *     старе валідне значення зі success-toast — сценарій silent data-loss.
 *  3. Lifecycle reset: `startEdit` re-ініціалізує raw з поточного `value`
 *     (formatted), `cancel` повертає у read-mode і чистить parseErr;
 *     `save success` те саме.
 */
function MoneyEditableField({
    label,
    value,
    onSave,
}: {
    label: string;
    value: number | null;
    onSave: (next: number | null) => Promise<void>;
}) {
    const [editing, setEditing] = useState(false);
    const [raw, setRaw] = useState(formatKopecksForInput(value));
    const [parseErr, setParseErr] = useState<MoneyParseError | null>(null);
    const [saveErr, setSaveErr] = useState<string | undefined>();
    const [saving, setSaving] = useState(false);

    const startEdit = () => {
        setRaw(formatKopecksForInput(value));
        setParseErr(null);
        setSaveErr(undefined);
        setEditing(true);
    };

    const cancel = () => {
        setEditing(false);
        setParseErr(null);
        setSaveErr(undefined);
    };

    const save = async () => {
        const result = parseUaMoney(raw);
        if (!result.ok) {
            setParseErr(result.error);
            return;
        }
        setSaving(true);
        try {
            await onSave(result.kopecks);
            setEditing(false);
            setParseErr(null);
            setSaveErr(undefined);
        } catch (err: unknown) {
            setSaveErr(
                err instanceof Error ? err.message : 'Не вдалося зберегти',
            );
        } finally {
            setSaving(false);
        }
    };

    const handleChange = (input: string) => {
        setRaw(input);
        const result = parseUaMoney(input);
        setParseErr(result.ok ? null : result.error);
    };

    const errorMessage = parseErr ? mapValidationCode(parseErr) : saveErr;

    return (
        <div className="space-y-2">
            <p className="text-muted-foreground text-xs font-medium">{label}</p>
            {!editing ? (
                <div className="flex items-start justify-between gap-3">
                    <div className="text-foreground min-w-0 flex-1 break-words text-sm">
                        {formatKopecksAsHryvnia(value) ??
                            'Без суми (клієнт вводить у банку)'}
                    </div>
                    <UiButton
                        type="button"
                        variant="icon"
                        size="sm"
                        onClick={startEdit}
                        aria-label={`Редагувати: ${label}`}
                        IconLeft={<Pencil />}
                    />
                </div>
            ) : (
                <div className="space-y-2">
                    <UiInput
                        // `type="text"`, не `number` — щоб приймати UA-кому
                        // (HTML5 `number` interpret-ується locale-dependent).
                        type="text"
                        inputMode="decimal"
                        placeholder="1500,50 — порожнє для signage-mode"
                        value={raw}
                        onChange={(e) => handleChange(e.target.value)}
                        error={errorMessage}
                    />
                    <div className="flex justify-end gap-2">
                        <UiButton
                            type="button"
                            variant="text"
                            size="sm"
                            onClick={cancel}
                            disabled={saving}
                            IconLeft={<X />}
                        >
                            Скасувати
                        </UiButton>
                        <UiButton
                            type="button"
                            variant="filled"
                            size="sm"
                            onClick={() => void save()}
                            // Save заблокований на parse-error — defensive
                            // duplicate того save-guard-у (button disabled +
                            // save() no-op): button-disabled чітко комунікує
                            // стан користувачу, save-guard ловить race.
                            disabled={saving || parseErr !== null}
                            IconLeft={!saving ? <Check /> : undefined}
                        >
                            {saving ? <UiSpinner size="sm" /> : 'Зберегти'}
                        </UiButton>
                    </div>
                </div>
            )}
        </div>
    );
}
