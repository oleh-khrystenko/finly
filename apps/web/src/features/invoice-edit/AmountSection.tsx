'use client';

import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { type Invoice } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
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
        patch: Partial<Pick<Invoice, 'amount' | 'amountLocked'>>
    ) => Promise<void>;
}

/**
 * Sprint 4 §4.6 — рядок "Сума" у картці «Дані платежу».
 *
 * **Окреме поле суми.** Toggle блокування суми (`AmountLockSwitch`) винесено
 * окремим рядком картки (дзеркало SEO-тоглу на business-сторінці), тож тут
 * лишився чистий money-input. Coupled-rule SP-6: при `amount → null` сама
 * секція скидає `amountLocked` (signage-mode не має що блокувати).
 *
 * **Cardless** — рендериться рядком усередині спільної `PaymentDetailsCard`
 * (дзеркало business `RequisitesCard`), без власного `UiSectionCard`-
 * обгортника; титул блоку («Дані платежу») живе на merged-картці.
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
    );
}

/**
 * Тогл блокування суми — окремий рядок картки «Дані платежу», дизайн і логіка
 * дзеркалять SEO-тогл на business-сторінці (`business-edit/PublicSection`):
 * заголовок-статус ліворуч описує поточний стан, switch праворуч, пояснення
 * знизу. Заголовок міняється за станом (locked / editable / без суми), опис
 * пояснює, чим керує перемикач.
 *
 * **Чому окремий sub-component, а не inline-handler.** Switch ↔ network — це
 * save-state-машина: pending → success/error. Inline `void onSave(...)` ламав
 * на двох рівнях: (1) rejection з parent `handlePatch` (toast.error → throw)
 * ставав unhandled promise rejection, бо `void` не ловить throw; (2) без
 * `saving`-флага swap-spam під час слабкої мережі генерував N-паралельних
 * PATCH-ів — race на server-state з непередбачуваним фінальним `amountLocked`.
 * Local `saving` + try/catch тримає happy/error path симетричними з
 * `MoneyEditableField`. Toast про помилку лишається на parent-i (`handlePatch`).
 */
export function AmountLockSwitch({
    invoice,
    onSave,
}: {
    invoice: Invoice;
    onSave: Props['onSave'];
}) {
    const [saving, setSaving] = useState(false);
    const handleToggle = async (allowEdit: boolean) => {
        setSaving(true);
        try {
            await onSave({ amountLocked: !allowEdit });
        } catch {
            // Parent `handlePatch` уже показав toast.error і re-throw-нув —
            // ловимо тут, щоб не залишити unhandled rejection і повернути
            // switch у interactive-стан. Локального error-UI не показуємо:
            // toast — shared UX-канал invoice-cabinet, дублювати inline-
            // плашку зайве.
        } finally {
            setSaving(false);
        }
    };
    const noAmount = invoice.amount === null;
    const disabled = noAmount || saving;
    return (
        <label
            htmlFor="invoice-amount-lock"
            className={`flex flex-col gap-1 ${
                disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            }`}
        >
            <span className="flex items-center justify-between gap-3">
                <span className="text-foreground text-lg font-medium">
                    {noAmount
                        ? 'Клієнт вписує суму у банку сам'
                        : invoice.amountLocked
                          ? 'Клієнт сплатить точно зазначену суму'
                          : 'Клієнт може змінити суму перед оплатою'}
                </span>
                <UiSwitch
                    id="invoice-amount-lock"
                    className="shrink-0"
                    checked={!invoice.amountLocked}
                    disabled={disabled}
                    onChange={(allowEdit) => void handleToggle(allowEdit)}
                />
            </span>
            <span className="text-muted-foreground text-sm">
                {noAmount
                    ? 'Доступно лише коли задано суму. Поки суми немає, клієнт завжди вписує її сам.'
                    : 'Керує тим, чи може клієнт змінити суму у банку. Якщо вимкнено, клієнт сплатить рівно зазначену суму.'}
            </span>
        </label>
    );
}

/**
 * Money-aware inline-edit. Той самий read/edit/✓/✗ patern, що
 * `UiEditableField`, з трьома доданими інваріантами:
 *
 *  1. Raw string як single source of truth у edit-mode — `parseUaMoney`
 *     робить парс на кожному typing-event; UI бачить format-error live.
 *  2. **Save-guard на parse-error** (кнопка лишається клікабельною): при
 *     `parseErr !== null` `save()` — no-op без виклику `onSave`, а причина вже
 *     видима під полем (`error={errorMessage}`, live на кожному вводі). Це
 *     закриває payment-correctness регрес: raніше invalid input + click
 *     "Зберегти" зберігав старе валідне значення зі success-toast (silent
 *     data-loss), тепер користувач бачить чому save не пройшов, а не мертву
 *     кнопку.
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
                err instanceof Error ? err.message : 'Не вдалося зберегти'
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
            <p className="text-muted-foreground text-base font-medium">
                {label}
            </p>
            {!editing ? (
                <div className="flex items-center justify-between gap-3">
                    <div className="text-foreground min-w-0 flex-1 text-lg break-words">
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
                        placeholder="1500,50 (порожнє: суму вводить клієнт)"
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
                            loading={saving}
                            IconLeft={<Check />}
                        >
                            Зберегти
                        </UiButton>
                    </div>
                </div>
            )}
        </div>
    );
}
