'use client';

import { Trash2 } from 'lucide-react';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';

interface Props {
    onDelete: () => void;
}

/**
 * Sprint 9 §9.2 §6 — небезпечна зона account-cabinet-page. Тонкий рендер +
 * `onDelete` callback. Pre-check (`invoicesCount > 0`), confirm-dialog open,
 * 5s-undo, redirect — усе живе у callsite (cabinet account-page), щоб
 * `onDelete` працював як з frontend-pre-check, так і без нього.
 */
export default function DangerSection({ onDelete }: Props) {
    return (
        <UiSectionCard title="Небезпечна зона" variant="destructive">
            <p className="text-muted-foreground mt-2 text-base">
                Видалення повне і незворотне. Клієнти, які мають збережене
                посилання, не зможуть оплатити.
            </p>
            <p className="text-muted-foreground mt-2 text-base">
                Якщо рахунок має виставлені інвойси — спочатку видаліть їх або
                видаліть весь бізнес.
            </p>
            <div className="mt-4">
                <UiButton
                    type="button"
                    variant="destructive-outline"
                    size="md"
                    onClick={onDelete}
                    IconLeft={<Trash2 />}
                >
                    Видалити рахунок
                </UiButton>
            </div>
        </UiSectionCard>
    );
}
