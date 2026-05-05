'use client';

import { type Business, type SlugPreset } from '@finly/types';
import UiEditableField from '@/shared/ui/UiEditableField';
import UiSelect from '@/shared/ui/UiSelect';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import { useSlugPresetWarningStore } from './slugPresetWarningStore';

interface Props {
    business: Business;
    onSave: (
        patch: Pick<Business, 'invoiceSlugPresetDefault'>,
    ) => Promise<void>;
}

/**
 * Sprint 4 §4.4 — секція "Налаштування рахунків" на сторінці бізнесу.
 *
 * **Власник: `features/invoices` slice** — секція керує invoice-related
 * налаштуванням (хоча зберігається у Business-документі); тримати її поряд із
 * `slugPresetWarningStore` уникає cross-slice-import-у з business-edit.
 * `UiEditableField` — generic primitive у `shared/ui/`, доступний усім
 * feature-слайсам без feature→feature coupling-у.
 *
 * **Один dropdown — `invoiceSlugPresetDefault`.** 5 опцій (qr-decisions §4.3.1
 * + §4.5 SP-1):
 *  - "Не визначено" → `null` (форма використає global system fallback `simple`).
 *  - 4 пресети: simple / with-month / with-year / with-purpose.
 *
 * **Без `'random'` опції** — Sprint 4 §SP-1: random — flow для конкретного
 * інвойсу (form-time choice), не business-level налаштування. Розширення
 * `SLUG_PRESETS` на `'random'` зламало б Sprint 1 `Invoice.slugPreset`
 * analytics-семантику.
 *
 * **`with-purpose` тригерить confirmation-modal** (§4.5 SP-1 + §4.4): privacy-
 * risk warning через `useSlugPresetWarningStore`. Якщо ФОП відмінить — save
 * не виконується, EditableField лишається у edit-mode з draft-значенням.
 *
 * **Семантика `null`:** "не визначено" / "використати глобальний дефолт
 * системи". Глобальний дефолт = `simple` (єдине джерело правди — fallback
 * `?? 'simple'` у формі створення §4.5).
 */

/**
 * `UiSelect.value` приймає `string`. Ми кодуємо `null` як `'null'`-sentinel-
 * рядок (form-time only), потім converter-функції транслюють у/з real
 * `SlugPreset | null`. Це дозволяє dropdown тримати все 5 опцій у одному
 * select-i без зайвих UI-primitives.
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
    OPTIONS.map((o) => [o.value, o.label]),
);

function toFormValue(preset: SlugPreset | null): FormValue {
    return preset ?? 'null';
}

function fromFormValue(formValue: string): SlugPreset | null {
    return formValue === 'null' ? null : (formValue as SlugPreset);
}

export default function InvoicesSettingsSection({ business, onSave }: Props) {
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

    /**
     * Save-handler з confirmation-flow для `with-purpose`. Store API
     * `open(onConfirm, onCancel)` — обидва callback-и точкові, без
     * subscribe-race-у. Confirm → resolve → потім actual save (PATCH).
     * Cancel → reject з нейтральним error → EditableField лишається у
     * edit-mode з draft-значенням.
     */
    const handleSave = async (next: SlugPreset | null): Promise<void> => {
        // Однакове значення → no-op (`EditableField` уже фільтрує, але
        // defensively).
        if (next === business.invoiceSlugPresetDefault) return;

        if (next === 'with-purpose') {
            await new Promise<void>((resolve, reject) => {
                openWarning(
                    () => resolve(),
                    () => reject(new Error('Скасовано')),
                );
            });
        }

        await onSave({ invoiceSlugPresetDefault: next });
    };

    return (
        <UiSectionCard title="Налаштування рахунків">
            <UiEditableField<SlugPreset | null>
                label="Дефолт для нових рахунків"
                value={business.invoiceSlugPresetDefault}
                renderRead={renderRead}
                renderEdit={renderEdit}
                onSave={handleSave}
            />
            <p className="text-muted-foreground mt-3 text-xs">
                Цей варіант буде обраний за замовчуванням, коли ви натискатимете
                «Виставити рахунок».
            </p>
        </UiSectionCard>
    );
}
