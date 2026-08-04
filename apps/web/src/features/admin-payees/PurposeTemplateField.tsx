'use client';

import { useRef } from 'react';
import {
    PURPOSE_MARKERS,
    purposeMarkerToken,
    type PurposeMarker,
} from '@finly/types';

import UiButton from '@/shared/ui/UiButton';
import UiTextarea from '@/shared/ui/UiTextarea';

const MARKER_LABEL: Record<PurposeMarker, string> = {
    taxId: 'РНОКПП',
    fullName: 'ПІБ',
    period: 'період',
};

interface Props {
    value: string;
    onChange: (next: string) => void;
    error?: string;
    /** Підпис над полем: у отримувача і в реквізитів різна роль шаблону. */
    label: string;
    placeholder: string;
}

/**
 * Sprint 29 — редактор шаблону призначення платежу з кнопками вставки маркерів.
 * Спільний для отримувача (`AdminPayeeForm`) і його реквізитів
 * (`AdminPayeeAccountForm`): обидві поверхні адмінські, тож маркери підстановки
 * дозволені на обох, і правило вставки має бути одне.
 *
 * Маркер вставляється у позицію курсора, а не в кінець рядка: адмін дописує
 * `{period}` посеред фрази частіше, ніж наприкінці.
 */
export function PurposeTemplateField({
    value,
    onChange,
    error,
    label,
    placeholder,
}: Props) {
    const ref = useRef<HTMLTextAreaElement>(null);

    const insertMarker = (marker: PurposeMarker) => {
        const token = purposeMarkerToken(marker);
        const el = ref.current;
        if (!el) {
            onChange(value + token);
            return;
        }
        const start = el.selectionStart ?? value.length;
        const end = el.selectionEnd ?? value.length;
        onChange(value.slice(0, start) + token + value.slice(end));
        // Повертаємо фокус і ставимо курсор після вставленого маркера.
        requestAnimationFrame(() => {
            el.focus();
            const pos = start + token.length;
            el.setSelectionRange(pos, pos);
        });
    };

    return (
        <>
            <div className="mt-4 flex flex-wrap gap-2">
                {PURPOSE_MARKERS.map((marker) => (
                    <UiButton
                        key={marker}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => insertMarker(marker)}
                    >
                        Вставити {MARKER_LABEL[marker]}
                    </UiButton>
                ))}
            </div>
            <div className="mt-4">
                <UiTextarea
                    ref={ref}
                    label={label}
                    rows={3}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    error={error}
                    placeholder={placeholder}
                />
            </div>
        </>
    );
}
