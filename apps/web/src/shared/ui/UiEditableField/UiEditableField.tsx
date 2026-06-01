'use client';

import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import UiButton from '@/shared/ui/UiButton';
import { EditableFieldCancelledError } from './cancelled';
import type { UiEditableFieldProps } from './types';

/**
 * Sprint 3 §3.8 §E6 → Sprint 4 §4.4 — inline-edit per field (Stripe/Linear/
 * Notion-style). Read mode → "олівець" → edit mode з ✓/✗ кнопками.
 *
 * **Generic primitive у `shared/ui/`** — використовується кількома feature-
 * слайсами (`business-edit` секції; `invoices/InvoicesSettingsSection`).
 * За FSD-конвенцією primitives живуть у нижчому шарі без домен-знань.
 *
 * Props у `./types.ts` (за `docs/conventions/ui-primitives.md` §3:
 * `{Name}.tsx` + `types.ts` + `index.ts`).
 */
export default function UiEditableField<TValue>({
    label,
    value,
    renderRead,
    renderEdit,
    onSave,
    validate,
    disabled,
    hideDefaultPencil,
}: UiEditableFieldProps<TValue>) {
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
            // Sprint 4 review fix — sentinel-error для confirmation-flow:
            // caller (наприклад privacy-warning перед `with-purpose`-пресетом)
            // кидає `EditableFieldCancelledError` коли user скасовує підтвердження.
            // Тут пропускаємо без inline-помилки і ЗАЛИШАЄМОСЯ у edit-mode з
            // draft-значенням — user може спробувати знову або змінити вибір.
            if (err instanceof EditableFieldCancelledError) {
                return;
            }
            const msg =
                err instanceof Error ? err.message : 'Не вдалося зберегти';
            setError(msg);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-2">
            {label && (
                <p className="text-muted-foreground text-base font-medium">
                    {label}
                </p>
            )}
            {!editing ? (
                <div className="flex items-center justify-between gap-3">
                    <div className="text-foreground min-w-0 flex-1 text-lg break-words">
                        {renderRead(value, { value, startEdit })}
                    </div>
                    {!disabled && !hideDefaultPencil && (
                        // `variant="icon"` (а не `icon-compact`) — UiEditableField
                        // використовується у бізнес-кабінеті та invoice settings,
                        // що рендеряться на mobile-flow. `icon` гарантує
                        // 44×44-baseline touch-target за `responsive.md` §2.
                        <UiButton
                            type="button"
                            variant="icon"
                            size="sm"
                            onClick={startEdit}
                            aria-label={
                                label ? `Редагувати: ${label}` : 'Редагувати'
                            }
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
                            loading={saving}
                            IconLeft={<Check />}
                        >
                            Зберегти
                        </UiButton>
                    </div>
                </div>
            )}
        </div>
    );
}
