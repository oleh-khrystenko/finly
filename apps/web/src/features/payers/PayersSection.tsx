'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PAYERS_MAX_PER_USER, type CreatePayerDto } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';
import {
    createPayer,
    extractApiErrorCode,
    getApiMessage,
    updatePayer,
} from '@/shared/api';
import { usePayersStore } from '@/entities/payer';

import PayerForm from './PayerForm';
import { usePayerDeleteDialogStore } from './payerDeleteDialogStore';

/**
 * Sprint 30 — список платників у профілі. Сценарій бухгалтера: клієнтів багато,
 * їхні ПІБ і РНОКПП вводяться один раз, а далі обираються на податковій
 * сторінці. Це не міні-CRM — жодних полів понад ті, що йдуть у платіж.
 */
export default function PayersSection() {
    const payers = usePayersStore((s) => s.payers);
    const isLoading = usePayersStore((s) => s.isLoading);
    const isLoaded = usePayersStore((s) => s.isLoaded);
    const load = usePayersStore((s) => s.load);
    const upsert = usePayersStore((s) => s.upsert);
    const openDeleteDialog = usePayerDeleteDialogStore((s) => s.open);

    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    useEffect(() => {
        void load().catch(() => {
            toast.error('Не вдалося завантажити список платників');
        });
    }, [load]);

    const handleCreate = async (values: CreatePayerDto) => {
        try {
            upsert(await createPayer(values));
            setIsAdding(false);
            toast.success('Платника додано');
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'payers'));
        }
    };

    const handleUpdate = async (id: string, values: CreatePayerDto) => {
        try {
            upsert(await updatePayer(id, values));
            setEditingId(null);
            toast.success('Платника оновлено');
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'payers'));
        }
    };

    const limitReached = payers.length >= PAYERS_MAX_PER_USER;

    return (
        <UiSectionCard
            title="Платники"
            headerRight={
                !isAdding && (
                    <UiButton
                        type="button"
                        variant="text"
                        size="sm"
                        IconLeft={<Plus />}
                        onClick={() => {
                            if (limitReached) {
                                toast.error(
                                    `У списку вже ${PAYERS_MAX_PER_USER} платників. Видаліть непотрібні записи, щоб додати нового`
                                );
                                return;
                            }
                            setEditingId(null);
                            setIsAdding(true);
                        }}
                    >
                        Додати
                    </UiButton>
                )
            }
        >
            <p className="text-muted-foreground mt-2 text-sm">
                Люди, за яких ви платите податки: бухгалтер обирає клієнта на
                сторінці оплати, і його дані підставляються у призначення
                платежу. Видалити запис можна будь-коли. Ваших ФОПів і фізосіб з
                розділу «Отримувачі» додавати сюди не треба — вони вже є у
                виборі на сторінці оплати.
            </p>

            <div className="mt-4 space-y-3">
                {isAdding && (
                    <PayerForm
                        submitLabel="Додати"
                        onSubmit={handleCreate}
                        onCancel={() => setIsAdding(false)}
                    />
                )}

                {isLoading && !isLoaded && (
                    <div className="flex justify-center py-6">
                        <UiSpinner size="md" />
                    </div>
                )}

                {isLoaded && payers.length === 0 && !isAdding && (
                    <p className="text-muted-foreground py-2 text-sm">
                        Список порожній. Додайте платника, щоб не вводити його
                        ПІБ і РНОКПП вручну під час кожної оплати.
                    </p>
                )}

                {payers.map((payer) =>
                    editingId === payer.id ? (
                        <PayerForm
                            key={payer.id}
                            initialValue={{
                                fullName: payer.fullName,
                                taxId: payer.taxId,
                            }}
                            submitLabel="Зберегти"
                            onSubmit={(values) =>
                                handleUpdate(payer.id, values)
                            }
                            onCancel={() => setEditingId(null)}
                        />
                    ) : (
                        <div
                            key={payer.id}
                            className="border-border flex items-center justify-between gap-3 rounded-lg border p-3"
                        >
                            <div className="min-w-0">
                                <p className="text-foreground truncate text-sm font-medium">
                                    {payer.fullName}
                                </p>
                                <p className="text-muted-foreground text-sm">
                                    РНОКПП {payer.taxId}
                                </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <UiButton
                                    type="button"
                                    variant="icon"
                                    size="sm"
                                    aria-label={`Редагувати платника ${payer.fullName}`}
                                    IconLeft={<Pencil />}
                                    onClick={() => {
                                        setIsAdding(false);
                                        setEditingId(payer.id);
                                    }}
                                />
                                <UiButton
                                    type="button"
                                    variant="icon"
                                    size="sm"
                                    aria-label={`Видалити платника ${payer.fullName}`}
                                    IconLeft={<Trash2 />}
                                    onClick={() =>
                                        openDeleteDialog(
                                            payer.id,
                                            payer.fullName
                                        )
                                    }
                                />
                            </div>
                        </div>
                    )
                )}
            </div>
        </UiSectionCard>
    );
}
