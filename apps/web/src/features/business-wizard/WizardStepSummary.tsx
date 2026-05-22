'use client';

import {
    Briefcase,
    Building2,
    HeartHandshake,
    User,
    type LucideIcon,
} from 'lucide-react';
import {
    BUSINESS_TYPE_LABEL,
    TAXATION_SYSTEM_LABEL,
    type BusinessType,
} from '@finly/types';
import { taxIdFieldConfig } from '@/entities/business';
import { composeClasses } from '@/shared/lib';
import {
    useBusinessWizardStore,
    type BusinessWizardDraft,
    type BusinessWizardStep,
} from './businessWizardStore';

/**
 * Іконка-якір біля типу бізнесу — єдиний visual-cue у summary. Без іконок на
 * решті chip-ів навмисно: тип — це «ідентичність» одержувача, решта поля —
 * service-data (документ, ставка, статус). Розмежування на рівні візуальної
 * ієрархії читається без додаткового text-emphasis.
 */
const TYPE_ICON: Record<BusinessType, LucideIcon> = {
    individual: User,
    fop: Briefcase,
    tov: Building2,
    organization: HeartHandshake,
};

interface PrimaryChip {
    kind: 'primary';
    value: string;
    Icon: LucideIcon;
}

interface NeutralChip {
    kind: 'neutral';
    term: string;
    value: string;
    /** `font-mono` для числових value (taxId) — symmetric з IBAN-mask у AccountCard. */
    mono?: boolean;
}

type SummaryChip = PrimaryChip | NeutralChip;

/**
 * Кожне поле з'являється на кроках, що йдуть ПІСЛЯ кроку, де воно заповнюється.
 * На Step 1 (`type-name`) — `[]`, тож parent ховає секцію через
 * `chips.length === 0`.
 *
 * Labels беруться з spread-джерел правди (`@finly/types` + `entities/business`).
 * Drift «РНОКПП»/«ЄДРПОУ»/«ФОП» між формою і summary-секцією виключений by
 * design.
 */
function buildChipsForStep(
    step: BusinessWizardStep,
    draft: BusinessWizardDraft
): SummaryChip[] {
    const chips: SummaryChip[] = [];

    if (step === 'type-name') return chips;

    if (draft.type) {
        chips.push({
            kind: 'primary',
            value: BUSINESS_TYPE_LABEL[draft.type],
            Icon: TYPE_ICON[draft.type],
        });
    }
    if (draft.name) {
        chips.push({ kind: 'neutral', term: 'Назва', value: draft.name });
    }

    if (step === 'requisites') return chips;

    if (draft.type && draft.taxId) {
        chips.push({
            kind: 'neutral',
            term: taxIdFieldConfig(draft.type).label,
            value: draft.taxId,
            mono: true,
        });
    }

    if (step === 'taxation') return chips;

    if (draft.taxationSystem) {
        chips.push({
            kind: 'neutral',
            term: 'Оподаткування',
            value: TAXATION_SYSTEM_LABEL[draft.taxationSystem],
        });
    }
    if (draft.isVatPayer !== undefined) {
        chips.push({
            kind: 'neutral',
            term: 'ПДВ',
            value: draft.isVatPayer ? 'Платник' : 'Не платник',
        });
    }

    return chips;
}

interface Props {
    step: BusinessWizardStep;
}

/**
 * Read-only chip-row «що вже обрано» — контекст без необхідності клацати назад
 * по `StepNavigator`-у. Для зміни значення — past-step click у navigator-і або
 * «Назад» унизу форми; редагування у summary навмисно не робимо (дублювало б
 * primary-controls форми).
 */
export default function WizardStepSummary({ step }: Props) {
    const formData = useBusinessWizardStore((s) => s.formData);
    const chips = buildChipsForStep(step, formData);

    if (chips.length === 0) return null;

    return (
        <section
            aria-label="Вже обрано на попередніх кроках"
            className="border-border mb-5 border-b pb-5"
        >
            <p className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wider uppercase">
                Вже обрано
            </p>
            <ul className="flex flex-wrap gap-2">
                {chips.map((chip, idx) =>
                    chip.kind === 'primary' ? (
                        <li key={idx}>
                            <span className="border-primary/20 bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium">
                                <chip.Icon className="size-3.5" />
                                {chip.value}
                            </span>
                        </li>
                    ) : (
                        <li key={idx}>
                            <span className="border-border bg-secondary inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs">
                                <span className="text-muted-foreground">
                                    {chip.term}
                                </span>
                                <span
                                    className={composeClasses(
                                        'text-foreground font-medium break-all',
                                        chip.mono && 'font-mono'
                                    )}
                                >
                                    {chip.value}
                                </span>
                            </span>
                        </li>
                    )
                )}
            </ul>
        </section>
    );
}
