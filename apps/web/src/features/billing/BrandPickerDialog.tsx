'use client';

import { Plus } from 'lucide-react';
import UiButton from '@/shared/ui/UiButton';
import {
    UiModal,
    UiModalContent,
    UiModalHeader,
    UiModalTitle,
} from '@/shared/ui/UiModal';
import { useBrandPickerDialogStore } from './brandPickerDialogStore';

/**
 * Sprint 27 — вибір отримувача для прикріплення до Бренд-складу. Діалог лише
 * обирає: подальший флоу (вільний слот / доплата за слот / перший checkout)
 * виконує callback картки (`onPick`) уже після закриття пікера — жодних
 * вкладених overlay-ів (overlays.md, правило 7).
 */
export default function BrandPickerDialog() {
    const isOpen = useBrandPickerDialogStore((s) => s.isOpen);
    const close = useBrandPickerDialogStore((s) => s.close);
    const businesses = useBrandPickerDialogStore((s) => s.businesses);
    const onPick = useBrandPickerDialogStore((s) => s.onPick);

    const handleSelect = (businessId: string) => {
        close();
        onPick?.(businessId);
    };

    return (
        <UiModal open={isOpen} onOpenChange={(open) => !open && close()}>
            <UiModalContent>
                <UiModalHeader>
                    <UiModalTitle>Оберіть отримувача</UiModalTitle>
                </UiModalHeader>
                <div className="px-4 pb-6">
                    <ul className="max-h-80 space-y-1 overflow-y-auto">
                        {businesses.map((b) => (
                            <li key={b.id}>
                                <UiButton
                                    variant="text"
                                    size="md"
                                    onClick={() => handleSelect(b.id)}
                                    IconRight={<Plus className="size-4" />}
                                    className="w-full justify-between"
                                >
                                    <span className="min-w-0 truncate">
                                        {b.name}
                                    </span>
                                </UiButton>
                            </li>
                        ))}
                    </ul>
                </div>
            </UiModalContent>
        </UiModal>
    );
}
