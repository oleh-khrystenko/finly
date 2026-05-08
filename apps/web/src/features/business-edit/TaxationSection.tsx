'use client';

import { useState } from 'react';
import { Pencil, Check, X } from 'lucide-react';
import {
    TAXATION_SYSTEMS,
    TAXATION_SYSTEM_LABEL,
    isVatAllowedTaxationSystem,
    type Business,
    type TaxationSystem,
} from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSelect from '@/shared/ui/UiSelect';
import UiSpinner from '@/shared/ui/UiSpinner';
import UiSwitch from '@/shared/ui/UiSwitch';

const SELECT_OPTIONS = TAXATION_SYSTEMS.map((value) => ({
    value,
    label: TAXATION_SYSTEM_LABEL[value],
}));

/**
 * Sprint 7 §7.8 / §SP-3 — `Business.taxationSystem` і `isVatPayer` тепер
 * nullable (для individual / organization). TaxationSection семантично
 * валідна тільки для типів, що **мають** taxation-поля (`fop` / `tov`).
 *
 * Замість runtime-null-guard всередині секції robимо contract-narrow на
 * Props-рівні: parent (`(protected)/business/[slug]/page.tsx`) гарантує
 * non-null значення через `hasTaxationFields(business)` type-guard перед
 * рендером (Sprint 7 §7.8 conditional unmount). TS-помилка на рівні DOM-
 * insertion-у унеможливлює забуття цього guard-а.
 */
export type TaxationCapableBusiness = Business & {
    taxationSystem: TaxationSystem;
    isVatPayer: boolean;
};

/**
 * Type-guard для conditional-render-у TaxationSection. `requiresTaxation
 * (b.type)` гарантує narrow за Sprint 7 entity-refine
 * (`TAXATION_FIELDS_MISMATCH_TYPE`); явна null-перевірка — defensive для
 * legacy-документів і edge-cases (TS-narrow цей invariant з типу не виведе).
 */
export function hasTaxationFields(
    business: Business,
): business is TaxationCapableBusiness {
    return business.taxationSystem !== null && business.isVatPayer !== null;
}

interface Props {
    business: TaxationCapableBusiness;
    onSave: (
        patch: Pick<TaxationCapableBusiness, 'taxationSystem' | 'isVatPayer'>,
    ) => Promise<void>;
}

/**
 * Sprint 3 §3.8 §C1 — coupled card. Sprint plan §E6 пояснює: пара
 * `taxationSystem + isVatPayer` редагується разом (один "олівець" на всю
 * картку, два контроли всередині, один Save). Тому окрема implementation
 * замість двох `EditableField`-ів.
 *
 * Coupled-rule: при перемиканні taxationSystem на simplified-1/2, якщо
 * isVatPayer=true — automatically false. Save надсилає обидва поля за один
 * PATCH (bypass-ить service-side cross-field check).
 */
export default function TaxationSection({ business, onSave }: Props) {
    const [editing, setEditing] = useState(false);
    const [draftTaxation, setDraftTaxation] = useState<TaxationSystem>(
        business.taxationSystem,
    );
    const [draftVat, setDraftVat] = useState<boolean>(business.isVatPayer);
    const [error, setError] = useState<string | undefined>();
    const [saving, setSaving] = useState(false);

    const vatAllowedForDraft = isVatAllowedTaxationSystem(draftTaxation);

    const startEdit = () => {
        setDraftTaxation(business.taxationSystem);
        setDraftVat(business.isVatPayer);
        setError(undefined);
        setEditing(true);
    };

    const cancel = () => {
        setEditing(false);
        setError(undefined);
    };

    const save = async () => {
        setSaving(true);
        try {
            await onSave({
                taxationSystem: draftTaxation,
                isVatPayer: draftVat && vatAllowedForDraft,
            });
            setEditing(false);
            setError(undefined);
        } catch (err: unknown) {
            setError(
                err instanceof Error
                    ? err.message
                    : 'Не вдалося зберегти',
            );
        } finally {
            setSaving(false);
        }
    };

    const handleTaxationChange = (next: string) => {
        const ts = next as TaxationSystem;
        setDraftTaxation(ts);
        if (!isVatAllowedTaxationSystem(ts) && draftVat) {
            setDraftVat(false);
        }
    };

    return (
        <UiSectionCard
            title="Оподаткування"
            headerRight={
                !editing ? (
                    <UiButton
                        type="button"
                        variant="icon-compact"
                        size="sm"
                        onClick={startEdit}
                        aria-label="Редагувати: оподаткування"
                        IconLeft={<Pencil />}
                    />
                ) : undefined
            }
        >
            {!editing ? (
                <div className="mt-2 space-y-3">
                    <div>
                        <p className="text-muted-foreground text-xs font-medium">
                            Система оподаткування
                        </p>
                        <p className="text-foreground mt-1 text-sm">
                            {TAXATION_SYSTEM_LABEL[business.taxationSystem]}
                        </p>
                    </div>
                    <div>
                        <p className="text-muted-foreground text-xs font-medium">
                            Платник ПДВ
                        </p>
                        <p className="text-foreground mt-1 text-sm">
                            {business.isVatPayer ? 'Так' : 'Ні'}
                        </p>
                    </div>
                </div>
            ) : (
                <div className="mt-2 space-y-4">
                    <UiSelect
                        label="Система оподаткування"
                        options={SELECT_OPTIONS}
                        value={draftTaxation}
                        onChange={handleTaxationChange}
                    />
                    <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                        <label
                            htmlFor="taxation-vat-toggle"
                            className="flex flex-1 cursor-pointer flex-col gap-1"
                        >
                            <span className="text-foreground text-sm font-medium">
                                Платник ПДВ
                            </span>
                            {!vatAllowedForDraft && (
                                <span className="text-muted-foreground text-xs">
                                    ПДВ доступний для спрощеної-3 і загальної
                                </span>
                            )}
                        </label>
                        <UiSwitch
                            id="taxation-vat-toggle"
                            checked={draftVat && vatAllowedForDraft}
                            disabled={!vatAllowedForDraft}
                            onChange={setDraftVat}
                        />
                    </div>
                    {error && (
                        <p className="text-destructive text-xs">{error}</p>
                    )}
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
                            disabled={saving}
                            IconLeft={!saving ? <Check /> : undefined}
                        >
                            {saving ? <UiSpinner size="sm" /> : 'Зберегти'}
                        </UiButton>
                    </div>
                </div>
            )}
        </UiSectionCard>
    );
}
