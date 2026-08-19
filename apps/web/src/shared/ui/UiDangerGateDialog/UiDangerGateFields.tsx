'use client';

import { useId } from 'react';
import UiInput from '@/shared/ui/UiInput';
import type { DangerGate, DangerGateInput } from './types';

export interface UiDangerGateFieldsProps {
    gates: DangerGate[];
    /** Поточні значення полів; довжина відповідає `gates`. */
    values: string[];
    onChange: (index: number, value: string) => void;
    /**
     * Cloze-фраза підтвердження: текст із пропущеними числами, на місці яких
     * вставлені inline-поля (`input(i)` ↔ `gates[i]`).
     */
    renderPrompt: (input: DangerGateInput) => React.ReactNode;
}

/** Чи всі поля-замки збігаються з очікуваними значеннями. */
export function areDangerGatesSatisfied(
    gates: DangerGate[],
    values: string[]
): boolean {
    return (
        gates.length > 0 &&
        gates.every((gate, i) => values[i]?.trim() === gate.expected)
    );
}

/**
 * Контрольовані поля-замки без власного overlay. Виділені з
 * `UiDangerGateDialog`, щоб той самий запобіжник можна було поставити кроком
 * усередині більшої модалки (видалення акаунта: перелік → кількості → пароль),
 * не дублюючи ні логіку звірки, ні верстку inline-полів.
 */
export default function UiDangerGateFields({
    gates,
    values,
    onChange,
    renderPrompt,
}: UiDangerGateFieldsProps) {
    const baseId = useId();

    const renderInput: DangerGateInput = (index) => {
        const gate = gates[index];
        if (!gate) return null;
        return (
            <span className="inline-block w-16 align-middle">
                <UiInput
                    id={`${baseId}-${index}`}
                    aria-label={gate.label}
                    size="sm"
                    inputMode="numeric"
                    autoComplete="off"
                    className="text-center"
                    value={values[index] ?? ''}
                    onChange={(e) => onChange(index, e.target.value)}
                />
            </span>
        );
    };

    return (
        // `<div>`, не `<p>`: inline-поля — це UiInput з блоковим коренем, а
        // `<div>` усередині `<p>` дав би невалідний DOM-nesting.
        <div className="text-foreground text-sm leading-9">
            {renderPrompt(renderInput)}
        </div>
    );
}
