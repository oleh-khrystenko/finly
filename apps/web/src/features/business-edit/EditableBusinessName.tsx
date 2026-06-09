'use client';

import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { businessNameSchema } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import { mapValidationCode } from '@/shared/lib';

interface Props {
    name: string;
    onSave: (name: string) => Promise<void>;
}

/**
 * Inline-edit назви бізнесу прямо в h1 шапки сторінки. Read mode — звичайний
 * `<h1>` + олівчик-кнопка поруч; edit mode — UiInput з кнопками Зберегти/
 * Скасувати знизу. Замінює окрему `BasicSection` (повністю дублювала h1 +
 * eyebrow зверху), не використовує `UiEditableField` бо той рендерить власний
 * дрібний label, що не пасує до heading-області.
 */
export default function EditableBusinessName({ name, onSave }: Props) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(name);
    const [error, setError] = useState<string | undefined>();
    const [saving, setSaving] = useState(false);

    const startEdit = () => {
        setDraft(name);
        setError(undefined);
        setEditing(true);
    };

    const cancel = () => {
        setEditing(false);
        setError(undefined);
    };

    const save = async () => {
        const parsed = businessNameSchema.safeParse(draft);
        if (!parsed.success) {
            setError(
                mapValidationCode(parsed.error.issues[0]?.message) ??
                    'Невірне значення'
            );
            return;
        }
        setSaving(true);
        try {
            await onSave(parsed.data);
            setEditing(false);
            setError(undefined);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Не вдалося зберегти');
        } finally {
            setSaving(false);
        }
    };

    if (editing) {
        return (
            <div className="flex min-w-0 flex-col gap-3">
                <UiInput
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    error={error}
                    size="lg"
                    autoFocus
                    aria-label="Назва отримувача"
                />
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
        );
    }

    return (
        <div className="flex min-w-0 items-center justify-between gap-2">
            <h1 className="text-foreground min-w-0 text-3xl font-bold tracking-tight break-words md:text-4xl">
                {name}
            </h1>
            <UiButton
                type="button"
                variant="icon"
                size="md"
                onClick={startEdit}
                aria-label="Редагувати назву"
                IconLeft={<Pencil />}
                className="shrink-0"
            />
        </div>
    );
}
