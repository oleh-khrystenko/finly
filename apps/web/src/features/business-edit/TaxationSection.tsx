'use client';

import { useMemo, useState } from 'react';
import { Pencil, Check, X } from 'lucide-react';
import {
    TAXATION_SYSTEMS,
    TAXATION_SYSTEM_LABEL,
    isTaxationAllowedForType,
    requiresTaxation,
    type Business,
    type TaxationSystem,
} from '@finly/types';
import {
    VAT_CHOICE_SECTION_LABEL,
    getVatChoiceOptions,
    isVatChoiceApplicable,
    vatBoolToChoice,
    vatChoiceToBool,
    type VatChoice,
} from '@/entities/business';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSelect from '@/shared/ui/UiSelect';
import UiRadioCardGroup from '@/shared/ui/UiRadioCardGroup';

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
 * Type-guard для conditional-render-у TaxationSection. Sprint 7 §7.8 acceptance —
 * **type-driven primary condition** (`requiresTaxation(b.type)`), плюс
 * data-driven secondary (non-null both fields) для TS-narrow до
 * `TaxationCapableBusiness`.
 *
 * **Чому обидві перевірки, а не лише `requiresTaxation`**:
 *  - `requiresTaxation(b.type)` — primary, semantic-truth: "цей тип бізнесу
 *    має taxation-поля". Conditional render у `business/[slug]/page.tsx`
 *    реально type-driven — секція рендериться **лише** для `fop` / `tov`,
 *    незалежно від data-state.
 *  - `b.taxationSystem !== null && b.isVatPayer !== null` — secondary,
 *    TS-narrow для `Props.business: TaxationCapableBusiness`. Без data-check
 *    TS-narrow з `requiresTaxation` boolean не виводиться — `taxationSystem`
 *    залишається `TaxationSystem | null`, що ламає тип props.
 *  - **Drift-protection**: legacy-документ ФОП без taxation-полів (gap у
 *    міграції) — guard повертає false → секція не рендериться → uncrash
 *    runtime. Symmetric: drift'd individual з non-null taxation
 *    (data-corruption через bypass entity-Zod) — guard теж false, секція
 *    лишається unmounted (бо primary `requiresTaxation` false).
 *
 * Sprint 7 entity-Zod refine `TAXATION_FIELDS_MISMATCH_TYPE` гарантує iff на
 * read-side; цей guard — runtime-safety для render-path-у, де entity-Zod
 * може бути bypass-ний (raw aggregation output, mocked test fixtures).
 */
export function hasTaxationFields(
    business: Business
): business is TaxationCapableBusiness {
    return (
        requiresTaxation(business.type) &&
        business.taxationSystem !== null &&
        business.isVatPayer !== null
    );
}

interface Props {
    business: TaxationCapableBusiness;
    onSave: (
        patch: Pick<TaxationCapableBusiness, 'taxationSystem' | 'isVatPayer'>
    ) => Promise<void>;
}

/**
 * Sprint 3 §3.8 §C1 — coupled card. Pair `taxationSystem + isVatPayer`
 * редагується разом (один "олівець" на всю картку, два контроли всередині,
 * один Save). Sprint 13 — VAT-tumbler замінено на `UiRadioCardGroup` з
 * контекстними title/description per system (ст. 293.3 ПКУ — на Спрощеній-3
 * це вибір ставки; ст. 181/182 ПКУ — на Загальній це факт реєстрації).
 *
 * Coupled-rule: при перемиканні taxationSystem на не-VAT-allowed систему
 * (`simplified-1/2`) — radio-cards секція ховається, а `draftVat` обнуляється
 * на `false`, щоб submit ніс legitimate pair. Save надсилає обидва поля за
 * один PATCH (bypass-ить service-side cross-field check).
 */
export default function TaxationSection({ business, onSave }: Props) {
    const [editing, setEditing] = useState(false);
    const [draftTaxation, setDraftTaxation] = useState<TaxationSystem>(
        business.taxationSystem
    );
    const [draftVat, setDraftVat] = useState<boolean>(business.isVatPayer);
    const [error, setError] = useState<string | undefined>();
    const [saving, setSaving] = useState(false);

    // ПКУ розд. XIV гл. 1: ТОВ обмежений Спрощеною-3 і Загальною; ФОП — усі 4.
    // `business.type` immutable post-creation, тож allowed-set обчислюємо один
    // раз на mount.
    const selectOptions = useMemo(
        () =>
            TAXATION_SYSTEMS.filter((system) =>
                isTaxationAllowedForType(business.type, system)
            ).map((value) => ({
                value,
                label: TAXATION_SYSTEM_LABEL[value],
            })),
        [business.type]
    );

    const vatApplicable = isVatChoiceApplicable(draftTaxation);
    const vatOptions = useMemo(
        () => (vatApplicable ? getVatChoiceOptions(draftTaxation) : null),
        [vatApplicable, draftTaxation]
    );

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
                isVatPayer: vatApplicable ? draftVat : false,
            });
            setEditing(false);
            setError(undefined);
        } catch (err: unknown) {
            setError(
                err instanceof Error ? err.message : 'Не вдалося зберегти'
            );
        } finally {
            setSaving(false);
        }
    };

    const handleTaxationChange = (next: string) => {
        const ts = next as TaxationSystem;
        setDraftTaxation(ts);
        // Coupled-flip: системи, де ПДВ юридично заборонений (Спрощена-1/2),
        // не показують radio-card-секцію. Обнуляємо drafт-VAT, щоб submit
        // не ніс stale-true з попередньої системи.
        if (!isVatChoiceApplicable(ts)) {
            setDraftVat(false);
        }
    };

    const handleVatChange = (next: VatChoice) => {
        setDraftVat(vatChoiceToBool(next));
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
                        options={selectOptions}
                        value={draftTaxation}
                        onChange={handleTaxationChange}
                    />
                    {vatApplicable && vatOptions && (
                        <UiRadioCardGroup<VatChoice>
                            label={VAT_CHOICE_SECTION_LABEL[draftTaxation]}
                            options={vatOptions}
                            value={vatBoolToChoice(draftVat)}
                            onChange={handleVatChange}
                            columns={{ mobile: 1, desktop: 2 }}
                        />
                    )}
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
                            loading={saving}
                            IconLeft={<Check />}
                        >
                            Зберегти
                        </UiButton>
                    </div>
                </div>
            )}
        </UiSectionCard>
    );
}
