'use client';

import { useState, type ReactNode } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import UiButton from '@/shared/ui/UiButton';
import UiSpinner from '@/shared/ui/UiSpinner';

interface RenderArgs<TValue> {
    value: TValue;
    setValue: (next: TValue) => void;
    error?: string;
}

interface Props<TValue> {
    label: string;
    value: TValue;
    /** Renderer для read-only вигляду (повертає string або ReactNode). */
    renderRead: (value: TValue) => ReactNode;
    /** Renderer редаговного контролу (input/select/textarea). */
    renderEdit: (args: RenderArgs<TValue>) => ReactNode;
    /**
     * Async-save handler. Throws на помилку → EditableField лишається в
     * editing-режимі, показує error. На success → читання-режим.
     */
    onSave: (next: TValue) => Promise<void>;
    /** Optional client-side validation. Повертає error-message або null. */
    validate?: (next: TValue) => string | null;
    disabled?: boolean;
}

/**
 * Sprint 3 §3.8 §E6 — inline-edit per field (Stripe/Linear/Notion-style).
 * Read mode → "олівець" → edit mode з ✓/✗ кнопками. Reusable у Sprint 4
 * для invoice-форм без дублювання.
 */
export default function EditableField<TValue>({
    label,
    value,
    renderRead,
    renderEdit,
    onSave,
    validate,
    disabled,
}: Props<TValue>) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<TValue>(value);
    const [error, setError] = useState<string | undefined>();
    const [saving, setSaving] = useState(false);

    const startEdit = () => {
        setDraft(value);
        setError(undefined);
        setEditing(true);
    };

    const cancel = () => {
        setEditing(false);
        setError(undefined);
    };

    const save = async () => {
        if (validate) {
            const err = validate(draft);
            if (err) {
                setError(err);
                return;
            }
        }
        setSaving(true);
        try {
            await onSave(draft);
            setEditing(false);
            setError(undefined);
        } catch (err: unknown) {
            const msg =
                err instanceof Error ? err.message : 'Не вдалося зберегти';
            setError(msg);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-2">
            <p className="text-muted-foreground text-xs font-medium">{label}</p>
            {!editing ? (
                <div className="flex items-start justify-between gap-3">
                    <div className="text-foreground min-w-0 flex-1 break-words text-sm">
                        {renderRead(value)}
                    </div>
                    {!disabled && (
                        <UiButton
                            type="button"
                            variant="icon-compact"
                            size="sm"
                            onClick={startEdit}
                            aria-label={`Редагувати: ${label}`}
                            IconLeft={<Pencil />}
                        />
                    )}
                </div>
            ) : (
                <div className="space-y-2">
                    {renderEdit({ value: draft, setValue: setDraft, error })}
                    <div className="flex justify-end gap-2">
                        <UiButton
                            type="button"
                            variant="text"
                            size="sm"
                            onClick={cancel}
                            disabled={saving}
                            IconLeft={<X />}
                        >
                            Скасувати
                        </UiButton>
                        <UiButton
                            type="button"
                            variant="filled"
                            size="sm"
                            onClick={() => void save()}
                            disabled={saving}
                            IconLeft={!saving ? <Check /> : undefined}
                        >
                            {saving ? <UiSpinner size="sm" /> : 'Зберегти'}
                        </UiButton>
                    </div>
                </div>
            )}
        </div>
    );
}

