'use client';

import { useState } from 'react';
import type { AutoSlugMode } from '@finly/types';
import { useAutoCancelOnRouteChange } from '@/shared/lib';
import {
    UiModal,
    UiModalContent,
    UiModalHeader,
    UiModalTitle,
} from '@/shared/ui/UiModal';
import UiButton from '@/shared/ui/UiButton';
import {
    InvoiceFormatPicker,
    RESET_FORMAT_ORDER,
    isAutoSlugMode,
} from '@/entities/invoice';
import { useResetInvoiceSlugConfirmStore } from './resetInvoiceSlugConfirmStore';

/**
 * Sprint 17 §billing-design — діалог перевипуску посилання. Раніше простий
 * confirm; тепер містить picker формату (5 авто-режимів, без ручного вводу: він
 * вже є кнопкою «Редагувати» на сторінці). Picker відкривається на «домашньому»
 * форматі рахунку, дозволяє разову заміну і дефолт рахунку НЕ змінює. Privacy-
 * застереження для `with-purpose` — inline-текстом, без модалки поверх модалки.
 */
export default function ResetInvoiceSlugConfirmDialog() {
    const isOpen = useResetInvoiceSlugConfirmStore((s) => s.isOpen);
    const defaultMode = useResetInvoiceSlugConfirmStore((s) => s.defaultMode);
    const onConfirm = useResetInvoiceSlugConfirmStore((s) => s.onConfirm);
    const close = useResetInvoiceSlugConfirmStore((s) => s.close);

    useAutoCancelOnRouteChange(isOpen, close);

    const [selected, setSelected] = useState<AutoSlugMode>(
        defaultMode ?? 'simple'
    );

    // Перевідкриття на іншому рахунку → picker стартує з його домашнього формату.
    // Скидання під час рендеру (а не в ефекті): порівнюємо ключ відкриття з
    // попереднім, інакше синхронний setState в ефекті дає каскадний ре-рендер.
    const openKey = isOpen ? (defaultMode ?? 'simple') : null;
    const [prevOpenKey, setPrevOpenKey] = useState<AutoSlugMode | null>(
        openKey
    );
    if (openKey !== prevOpenKey) {
        setPrevOpenKey(openKey);
        if (openKey) setSelected(openKey);
    }

    const handleConfirm = () => {
        onConfirm?.(selected);
        close();
    };

    return (
        <UiModal open={isOpen} onOpenChange={(o) => !o && close()}>
            <UiModalContent>
                <UiModalHeader>
                    <UiModalTitle>Згенерувати нове посилання?</UiModalTitle>
                </UiModalHeader>
                <div className="space-y-5 px-4 pb-6">
                    <p className="text-muted-foreground text-sm">
                        Адреса отримає наступний номер у вибраному форматі.
                        Оригінальний номер не повернеться. Старі збережені
                        посилання і надруковані QR ще певний час працюватимуть і
                        вестимуть на нову адресу, потім перестануть.
                    </p>

                    <InvoiceFormatPicker
                        value={selected}
                        onChange={(next) => {
                            if (isAutoSlugMode(next)) setSelected(next);
                        }}
                        options={RESET_FORMAT_ORDER}
                        defaultMode={defaultMode}
                        label="Формат номера"
                    />

                    {selected === 'with-purpose' && (
                        <p className="text-muted-foreground text-sm">
                            Зверніть увагу: у посилання потраплять ключові слова
                            з призначення платежу. Краще для нейтральних
                            формулювань (наприклад «послуги», «консультація»).
                        </p>
                    )}

                    <div className="flex justify-end gap-3">
                        <UiButton
                            type="button"
                            variant="text"
                            size="md"
                            onClick={close}
                        >
                            Скасувати
                        </UiButton>
                        <UiButton
                            type="button"
                            variant="filled"
                            size="md"
                            onClick={handleConfirm}
                        >
                            Згенерувати
                        </UiButton>
                    </div>
                </div>
            </UiModalContent>
        </UiModal>
    );
}
