'use client';

import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { type Invoice } from '@finly/types';
import { formatKyivDate } from '@/shared/lib';
import UiButton from '@/shared/ui/UiButton';
import {
    EMPTY_VALID_UNTIL_DRAFT,
    ValidUntilField,
    draftFromValue,
    resolveValidUntil,
    type ValidUntilDraft,
} from '@/entities/invoice';

interface Props {
    invoice: Invoice;
    onSave: (patch: Partial<Pick<Invoice, 'validUntil'>>) => Promise<void>;
}

/**
 * Sprint 4 §4.6 — рядок "Термін дії" у картці «Дані платежу».
 *
 * **Cardless** — рядок усередині спільної `PaymentDetailsCard`. Badge
 * "Прострочено" живе у хедері merged-картки, щоб статус читався на рівні всього
 * блоку параметрів, а не загубленого рядка.
 *
 * **Спільний редактор** — read-display + edit-lifecycle (pencil / save / cancel)
 * лишаються тут (inline-edit патерн detail-сторінки), а саме поле вводу дати
 * делеговано `ValidUntilField` з `entities/invoice` (single source of truth з
 * create-формою: ручний ввід `ДД.ММ.РРРР` + календар, Kyiv-tz, live-валідація).
 */
export default function ValidUntilSection({ invoice, onSave }: Props) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<ValidUntilDraft>(
        EMPTY_VALID_UNTIL_DRAFT
    );
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | undefined>();

    const startEdit = () => {
        setDraft(draftFromValue(invoice.validUntil));
        setSaveError(undefined);
        setEditing(true);
    };

    const cancel = () => {
        setEditing(false);
        setSaveError(undefined);
    };

    const save = async () => {
        const { value, valid } = resolveValidUntil(draft);
        // Не блокуємо кнопку — на невалідній даті показуємо причину під полем
        // (порожній ввід live-валідатор не червонить, тож повідомлення тут —
        // єдиний сигнал користувачу), і не пишемо silent null.
        if (!valid) {
            setSaveError(
                'Введіть дату у форматі ДД.ММ.РРРР або оберіть «Без терміну»'
            );
            return;
        }
        setSaving(true);
        try {
            await onSave({ validUntil: value });
            setEditing(false);
            setSaveError(undefined);
        } catch (err: unknown) {
            setSaveError(
                err instanceof Error ? err.message : 'Не вдалося зберегти'
            );
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-2">
            <p className="text-muted-foreground text-base font-medium">
                Термін дії
            </p>
            {!editing ? (
                <div className="flex items-center justify-between gap-3">
                    <div className="text-foreground min-w-0 flex-1 text-lg break-words">
                        {invoice.validUntil === null
                            ? 'Без терміну'
                            : formatKyivDate(new Date(invoice.validUntil))}
                    </div>
                    <UiButton
                        type="button"
                        variant="icon"
                        size="sm"
                        onClick={startEdit}
                        aria-label="Редагувати: Термін дії"
                        IconLeft={<Pencil />}
                    />
                </div>
            ) : (
                <div className="space-y-3">
                    <ValidUntilField
                        draft={draft}
                        onChange={(next) => {
                            setSaveError(undefined);
                            setDraft(next);
                        }}
                        error={saveError}
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
            )}
        </div>
    );
}
