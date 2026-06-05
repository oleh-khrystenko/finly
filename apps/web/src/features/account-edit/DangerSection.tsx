'use client';

import { Trash2 } from 'lucide-react';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';

interface Props {
    onDelete: () => void;
}

/**
 * Небезпечна зона account-cabinet-page. Тонкий рендер + `onDelete` callback.
 * Confirm-dialog (з cascade-gate, якщо є рахунки), 5s-undo, redirect — усе
 * живе у callsite (cabinet account-page).
 */
export default function DangerSection({ onDelete }: Props) {
    return (
        <UiSectionCard title="Небезпечна зона" variant="destructive">
            <p className="text-muted-foreground mt-2 text-base">
                Видалення повне і незворотне. Реквізити зникнуть разом з усіма
                виставленими рахунками. Клієнти, які мають збережене посилання,
                не зможуть оплатити.
            </p>
            <div className="mt-4">
                <UiButton
                    type="button"
                    variant="destructive-outline"
                    size="md"
                    onClick={onDelete}
                    IconLeft={<Trash2 />}
                >
                    Видалити реквізити
                </UiButton>
            </div>
        </UiSectionCard>
    );
}
