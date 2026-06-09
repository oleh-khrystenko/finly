'use client';

import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import {
    BANK_LABEL,
    accountNameSchema,
    deriveAccountLabel,
    type Account,
} from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import { mapValidationCode } from '@/shared/lib';

interface Props {
    account: Account;
    onSave: (name: string) => Promise<void>;
}

/**
 * Sprint 15 — inline-edit назви рахунку прямо в h1 шапки account-cabinet-page,
 * дзеркало `EditableBusinessName`. Read mode: derived-лейбл (власна назва або
 * `"monobank •4847"`) + приглушений parenthetical-disambiguator (банк + маска,
 * коли є власна назва) + олівчик-кнопка. Edit mode: UiInput з placeholder =
 * derived-лейбл (підказка дефолту) + Зберегти/Скасувати знизу.
 *
 * Назву можна лише задати/змінити на непорожню (`accountNameSchema` min 1).
 * Скидання на `null` через це поле неможливе — як і в `EditableBusinessName`.
 */
export default function EditableAccountName({ account, onSave }: Props) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(account.name ?? '');
    const [error, setError] = useState<string | undefined>();
    const [saving, setSaving] = useState(false);

    const ibanMask = `•${account.iban.slice(-4)}`;
    const bankLabel =
        account.bankCode !== null ? BANK_LABEL[account.bankCode] : null;
    const derivedLabel = deriveAccountLabel({
        name: account.name,
        bankCode: account.bankCode,
        ibanMask,
    });
    const headingParenthetical =
        account.name === null
            ? ''
            : bankLabel
              ? ` (${bankLabel} ${ibanMask})`
              : ` (${ibanMask})`;

    const startEdit = () => {
        setDraft(account.name ?? '');
        setError(undefined);
        setEditing(true);
    };

    const cancel = () => {
        setEditing(false);
        setError(undefined);
    };

    const save = async () => {
        const parsed = accountNameSchema.safeParse(draft);
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
            setError(
                err instanceof Error ? err.message : 'Не вдалося зберегти'
            );
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
                    placeholder={derivedLabel}
                    maxLength={60}
                    aria-label="Назва реквізитів"
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
                {derivedLabel}
                <span className="text-muted-foreground font-normal">
                    {headingParenthetical}
                </span>
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
