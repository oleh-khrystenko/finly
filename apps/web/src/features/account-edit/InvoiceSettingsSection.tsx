'use client';

import type { Account, SlugPreset } from '@finly/types';
import UiEditableField, {
    EditableFieldCancelledError,
} from '@/shared/ui/UiEditableField';
import UiSelect from '@/shared/ui/UiSelect';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import { useSlugPresetWarningStore } from '@/entities/invoice';

interface Props {
    account: Account;
    onSave: (
        patch: Pick<Account, 'invoiceSlugPresetDefault'>
    ) => Promise<void>;
}

/**
 * Sprint 9 §SP-6 — секція "Налаштування рахунків" на account-cabinet-page.
 * До Sprint 9 жила на business-cabinet (Sprint 4 §4.4); переїхала на account
 * разом з per-account-нумерацією інвойсів (§SP-6).
 *
 * **5 опцій dropdown** (qr-decisions §4.3.1 + §4.5 SP-1):
 *  - "Не визначено" → `null` (форма використає global system fallback `simple`).
 *  - 4 пресети: simple / with-month / with-year / with-purpose.
 *
 * **`with-purpose` тригерить confirmation-modal** — privacy-risk warning
 * через `useSlugPresetWarningStore`. Cancel → save не виконується, edit-mode
 * лишається з draft-значенням.
 *
 * **Семантика `null`**: "не визначено" / "використати глобальний дефолт
 * системи" = `simple`.
 */

type FormValue = SlugPreset | 'null';

const OPTIONS: { value: FormValue; label: string }[] = [
    {
        value: 'null',
        label: 'Не визначено (за замовчуванням — простий номер)',
    },
    { value: 'simple', label: 'Простий номер (inv-001)' },
    { value: 'with-month', label: 'З місяцем (2026-05-001)' },
    { value: 'with-year', label: 'З роком (2026-001)' },
    { value: 'with-purpose', label: 'З призначення (oplata-...)' },
];

const LABEL_BY_VALUE = new Map<string, string>(
    OPTIONS.map((o) => [o.value, o.label])
);

function toFormValue(preset: SlugPreset | null): FormValue {
    return preset ?? 'null';
}

function fromFormValue(formValue: string): SlugPreset | null {
    return formValue === 'null' ? null : (formValue as SlugPreset);
}

export default function InvoiceSettingsSection({ account, onSave }: Props) {
    const openWarning = useSlugPresetWarningStore((s) => s.open);

    const renderRead = (preset: SlugPreset | null) => (
        <span>{LABEL_BY_VALUE.get(toFormValue(preset)) ?? '—'}</span>
    );

    const renderEdit = ({
        value,
        setValue,
    }: {
        value: SlugPreset | null;
        setValue: (next: SlugPreset | null) => void;
    }) => (
        <UiSelect
            options={OPTIONS}
            value={toFormValue(value)}
            onChange={(next) => setValue(fromFormValue(next))}
        />
    );

    const handleSave = async (next: SlugPreset | null): Promise<void> => {
        if (next === account.invoiceSlugPresetDefault) return;

        if (next === 'with-purpose') {
            const confirmed = await new Promise<boolean>((resolve) => {
                openWarning(
                    () => resolve(true),
                    () => resolve(false)
                );
            });
            if (!confirmed) {
                throw new EditableFieldCancelledError();
            }
        }

        await onSave({ invoiceSlugPresetDefault: next });
    };

    return (
        <UiSectionCard title="Налаштування інвойсів">
            <UiEditableField<SlugPreset | null>
                label="Дефолт для нових інвойсів"
                value={account.invoiceSlugPresetDefault}
                renderRead={renderRead}
                renderEdit={renderEdit}
                onSave={handleSave}
            />
            <p className="text-muted-foreground mt-3 text-xs">
                Цей варіант буде обраний за замовчуванням, коли ви натискатимете
                «Виставити інвойс» з цього рахунку.
            </p>
        </UiSectionCard>
    );
}
