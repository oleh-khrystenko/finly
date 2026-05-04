'use client';

import { composeClasses } from '@/shared/lib';
import type { WizardStep } from './businessWizardStore';

const STEP_TITLES: Record<WizardStep, string> = {
    1: 'Тип і назва',
    2: 'Реквізити',
    3: 'Оподаткування',
    4: 'Призначення і банки',
};

interface Props {
    current: WizardStep;
    maxReached: WizardStep;
    onJumpBack: (step: WizardStep) => void;
}

/**
 * Sprint 3 §3.7 — горизонтальний на ≥sm, вертикальний "Крок N з 4" на mobile.
 * Майбутні кроки не клікабельні (валідація поточного має пройти); пройдені —
 * клікабельні (повернення без втрати state, бо все persistить у store).
 */
export default function StepNavigator({
    current,
    maxReached,
    onJumpBack,
}: Props) {
    const steps: WizardStep[] = [1, 2, 3, 4];

    return (
        <div>
            {/* Mobile compact */}
            <div className="sm:hidden">
                <p className="text-muted-foreground text-sm">
                    Крок {current} з 4
                </p>
                <p className="text-foreground text-base font-semibold">
                    {STEP_TITLES[current]}
                </p>
            </div>

            {/* Desktop horizontal */}
            <ol className="hidden items-center justify-between gap-2 sm:flex">
                {steps.map((s, idx) => {
                    const isCurrent = s === current;
                    const isPassed = s < current;
                    const isFuture = s > maxReached;
                    const clickable = s < current;
                    return (
                        <li
                            key={s}
                            className="flex flex-1 items-center gap-2"
                        >
                            <button
                                type="button"
                                onClick={() => clickable && onJumpBack(s)}
                                disabled={!clickable && !isCurrent}
                                aria-current={isCurrent ? 'step' : undefined}
                                className={composeClasses(
                                    'flex flex-1 flex-col items-start gap-1 rounded-md p-2 text-left transition-colors',
                                    clickable &&
                                        'hover:bg-accent cursor-pointer',
                                    !clickable && !isCurrent && 'opacity-50',
                                )}
                            >
                                <div className="flex items-center gap-2">
                                    <span
                                        className={composeClasses(
                                            'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                                            isCurrent &&
                                                'bg-primary text-primary-foreground',
                                            isPassed &&
                                                'bg-success text-success-foreground',
                                            isFuture &&
                                                'border-border text-muted-foreground border bg-background',
                                        )}
                                    >
                                        {s}
                                    </span>
                                    <span
                                        className={composeClasses(
                                            'text-sm',
                                            isCurrent && 'text-foreground font-semibold',
                                            !isCurrent && 'text-muted-foreground',
                                        )}
                                    >
                                        {STEP_TITLES[s]}
                                    </span>
                                </div>
                            </button>
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
