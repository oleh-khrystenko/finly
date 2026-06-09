import type { ReactNode } from 'react';

export interface DangerGate {
    /** Accessible-назва inline-поля (напр. "Реквізити"). */
    label: string;
    /** Точне значення, яке користувач має вписати, щоб розблокувати дію. */
    expected: string;
}

/** Рендерить inline-поле для gate з індексом `index` (повертає `null` поза межами). */
export type DangerGateInput = (index: number) => ReactNode;

export interface UiDangerGateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    /** Попередження зверху: явний перелік, що саме і скільки буде видалено. */
    description?: ReactNode;
    /** Поля-замки. Дія розблоковується лише коли всі збігаються з `expected`. */
    gates: DangerGate[];
    /**
     * Cloze-фраза підтвердження: текст із пропущеними числами, на місці яких
     * вставлені inline-поля (`input(i)` ↔ `gates[i]`). Користувач має знайти
     * числа у `description` і вписати їх сюди.
     */
    renderPrompt: (input: DangerGateInput) => ReactNode;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
}
