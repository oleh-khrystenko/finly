'use client';

import type { ReactNode } from 'react';
import UiButton from '@/shared/ui/UiButton';
import { composeClasses } from '@/shared/lib';
import { STEP_TITLES, type BusinessWizardStep } from './businessWizardStore';

type StepState = 'passed' | 'current' | 'future';

interface Props {
    /** Поточний step. */
    current: BusinessWizardStep;
    /**
     * Sprint 7 §SP-6 — список кроків wizard-у залежно від обраного `type`.
     * Передається parent-ом (`BusinessWizardForm`), що читає
     * `computeStepsForType(formData.type)`. Тут не обчислюємо повторно —
     * presentation-component без store-доступу.
     */
    steps: readonly BusinessWizardStep[];
    /**
     * Виклик при click на past-step (clickable назад без втрати state).
     */
    onJumpBack: (step: BusinessWizardStep) => void;
}

/**
 * Number-indicator (1, 2, 3, ...) для одного step-а. Кольори різні per state:
 *  - `passed` — success-token (пройдений крок)
 *  - `current` — primary-token (active step)
 *  - `future` — muted, тільки border (ще-не-пройдений)
 *
 * Винесено окремо, бо як `passed`-варіант його приймає `UiButton.IconLeft`,
 * а як `current`/`future` — статичний `<span>`-wrapper.
 */
function StepIndicator({
    index,
    state,
}: {
    index: number;
    state: StepState;
}): ReactNode {
    return (
        <span
            className={composeClasses(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                state === 'current' && 'bg-primary text-primary-foreground',
                state === 'passed' && 'bg-success text-success-foreground',
                state === 'future' &&
                    'border-border text-muted-foreground bg-background border'
            )}
        >
            {index + 1}
        </span>
    );
}

/**
 * Sprint 3 §3.7 + Sprint 7 §SP-6 — горизонтальний на ≥sm, вертикальний
 * "Крок N з {steps.length}" на mobile.
 *
 * **Dynamic step-count**: для individual / organization wizard має 3 кроки
 * (без `'taxation'`), для fop / tov — 4. Лінійний індекс (`Крок N з M`)
 * обчислюється від `steps.indexOf(current)`.
 *
 * **Interactivity model**:
 *  - Past steps — clickable, рендеряться через `UiButton variant="text"
 *    size="sm"` з number-circle у `IconLeft`. **Жодних override-ів базових
 *    стилів примітиву** (`docs/conventions/ui-primitives.md` §2): padding /
 *    justify / cursor — від primitive-у as-is.
 *  - Current step — статичний `<span>`, не tabbable; виділяється primary-
 *    кольором + bold.
 *  - Future steps — статичні `<span>`, opacity-50; не interactive (нічого
 *    клікати — користувач туди ще не дійшов). Це знімає accessibility-
 *    шум "disabled-button у tab-flow".
 *
 * **Static spans мають свій padding/layout** — це не порушення §2, бо вони
 * native HTML elements без primitive-обгортки. Padding `px-3 py-1.5` свідомо
 * співпадає з `UiButton size="sm"` для візуальної узгодженості items у row.
 */
export default function StepNavigator({ current, steps, onJumpBack }: Props) {
    const currentIndex = steps.indexOf(current);
    // Defensive: якщо `current` випав з обчисленого list-у (зміна `type`
    // зробила step irrelevant — наприклад, користувач був на 'taxation' і
    // змінив type на 'individual') — рендеримо як перший.
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;

    return (
        <div>
            {/* Mobile compact */}
            <div className="sm:hidden">
                <p className="text-muted-foreground text-sm">
                    Крок {safeIndex + 1} з {steps.length}
                </p>
                <p className="text-foreground text-base font-semibold">
                    {STEP_TITLES[current]}
                </p>
            </div>

            {/* Desktop horizontal */}
            <ol className="hidden items-center justify-between gap-2 sm:flex">
                {steps.map((step, idx) => {
                    const stepState: StepState =
                        idx < safeIndex
                            ? 'passed'
                            : idx === safeIndex
                              ? 'current'
                              : 'future';

                    return (
                        <li
                            key={step}
                            className="flex flex-1 items-center gap-2"
                        >
                            {stepState === 'passed' ? (
                                <UiButton
                                    variant="text"
                                    size="sm"
                                    onClick={() => onJumpBack(step)}
                                    IconLeft={
                                        <StepIndicator
                                            index={idx}
                                            state="passed"
                                        />
                                    }
                                >
                                    {STEP_TITLES[step]}
                                </UiButton>
                            ) : (
                                <span
                                    aria-current={
                                        stepState === 'current'
                                            ? 'step'
                                            : undefined
                                    }
                                    className={composeClasses(
                                        'inline-flex items-center gap-2 px-3 py-1.5 text-sm',
                                        stepState === 'current' &&
                                            'text-foreground font-semibold',
                                        stepState === 'future' &&
                                            'text-muted-foreground opacity-50'
                                    )}
                                >
                                    <StepIndicator
                                        index={idx}
                                        state={stepState}
                                    />
                                    <span>{STEP_TITLES[step]}</span>
                                </span>
                            )}
                            {idx < steps.length - 1 && (
                                <div className="bg-border h-px flex-1" />
                            )}
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
