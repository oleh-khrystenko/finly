'use client';

import { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import UiButton from '@/shared/ui/UiButton';
import {
    UiModal,
    UiModalContent,
    UiModalHeader,
    UiModalTitle,
} from '@/shared/ui/UiModal';
import UiDangerGateFields, {
    areDangerGatesSatisfied,
} from './UiDangerGateFields';
import type {
    DangerGate,
    DangerGateInput,
    UiDangerGateDialogProps,
} from './types';

/**
 * Деструктивне підтвердження з gate-полями. Зверху — попередження з явним
 * переліком, скільки і чого зникне; знизу — cloze-фраза, де на місці тих самих
 * чисел стоять inline-поля. Кнопка дії розблоковується лише коли вписані числа
 * збігаються з `expected`.
 *
 * Тертя зчеплене з масштабом втрати: щоб заповнити поля, користувач мусить
 * прочитати попередження (числа там стоять у різних місцях залежно від назви),
 * тож рефлекс-автозаповнення не виробляється.
 *
 * UiModal, а не UiConfirmDialog, бо overlay містить форму
 * (`docs/conventions/overlays.md` §4).
 */
function UiDangerGateDialog({
    open,
    onOpenChange,
    title,
    description,
    gates,
    renderPrompt,
    confirmLabel,
    cancelLabel,
    onConfirm,
}: UiDangerGateDialogProps) {
    return (
        <UiModal open={open} onOpenChange={onOpenChange}>
            <UiModalContent>
                <UiModalHeader>
                    <UiModalTitle className="text-lg">{title}</UiModalTitle>
                    {description && (
                        <DialogPrimitive.Description className="text-muted-foreground text-sm">
                            {description}
                        </DialogPrimitive.Description>
                    )}
                </UiModalHeader>

                {/* GateForm монтується лише поки відкрито (Radix демонтує
                    Content на close), тож поля скидаються самі на кожне
                    відкриття — без setState-in-effect. */}
                <GateForm
                    gates={gates}
                    renderPrompt={renderPrompt}
                    confirmLabel={confirmLabel}
                    cancelLabel={cancelLabel}
                    onConfirm={onConfirm}
                    onCancel={() => onOpenChange(false)}
                />
            </UiModalContent>
        </UiModal>
    );
}

interface GateFormProps {
    gates: DangerGate[];
    renderPrompt: (input: DangerGateInput) => React.ReactNode;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
}

function GateForm({
    gates,
    renderPrompt,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
}: GateFormProps) {
    const [values, setValues] = useState<string[]>(() => gates.map(() => ''));

    return (
        <div className="flex flex-col gap-5 px-4 pb-4">
            <UiDangerGateFields
                gates={gates}
                values={values}
                onChange={(index, value) =>
                    setValues((prev) => {
                        const next = [...prev];
                        next[index] = value;
                        return next;
                    })
                }
                renderPrompt={renderPrompt}
            />

            <div className="flex justify-end gap-3">
                <UiButton
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={onCancel}
                >
                    {cancelLabel}
                </UiButton>
                <UiButton
                    type="button"
                    variant="destructive-outline"
                    size="md"
                    disabled={!areDangerGatesSatisfied(gates, values)}
                    onClick={onConfirm}
                >
                    {confirmLabel}
                </UiButton>
            </div>
        </div>
    );
}

UiDangerGateDialog.displayName = 'UiDangerGateDialog';

export default UiDangerGateDialog;
