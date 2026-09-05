'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import type {
    AccountDeletionConfirmMethod,
    AccountDeletionPayee,
    AccountDeletionPreview,
} from '@finly/types';
import {
    UiModal,
    UiModalContent,
    UiModalHeader,
    UiModalTitle,
} from '@/shared/ui/UiModal';
import UiButton from '@/shared/ui/UiButton';
import UiPasswordInput from '@/shared/ui/UiPasswordInput';
import {
    UiDangerGateFields,
    areDangerGatesSatisfied,
    type DangerGate,
} from '@/shared/ui/UiDangerGateDialog';
import { confirmDeleteAccount, deleteUserAccount } from '@/shared/api';
import { useAuthStore } from '@/entities/user';
import {
    accountActionErrorMessage,
    apiErrorCode,
} from './lib/accountActionError';
import { useDeleteAccountDialogStore } from './deleteAccountDialogStore';

const DeleteAccountFormSchema = z.object({
    password: z.string().min(1, 'Введіть пароль для підтвердження'),
});

type DeleteAccountFormValues = z.input<typeof DeleteAccountFormSchema>;

interface GateSpec {
    gates: DangerGate[];
    /** Слова для cloze-фрази у тому ж порядку, що й `gates`. */
    words: string[];
}

/**
 * Поля-замки лише для ненульових рівнів: отримувач без реквізитів дав би поле,
 * у яке треба вписати нуль, а це тертя без сенсу.
 */
function buildGates(totals: AccountDeletionPreview['totals']): GateSpec {
    const levels: Array<[string, number, string]> = [
        ['Отримувачі', totals.businessesCount, 'отримувачів'],
        ['Реквізити', totals.accountsCount, 'реквізитів'],
        ['Виставлені рахунки', totals.invoicesCount, 'рахунків'],
    ];
    const present = levels.filter(([, count]) => count > 0);
    return {
        gates: present.map(([label, count]) => ({
            label,
            expected: String(count),
        })),
        words: present.map(([, , word]) => word),
    };
}

function PayeeGroup({
    title,
    note,
    items,
}: {
    title: string;
    note?: string;
    items: AccountDeletionPayee[];
}) {
    if (items.length === 0) return null;
    return (
        <div className="mt-4">
            <p className="text-foreground text-sm font-medium">{title}</p>
            {note && <p className="text-muted-foreground text-xs">{note}</p>}
            <ul className="mt-2 space-y-1">
                {items.map((item, index) => (
                    <li
                        key={`${item.name}-${index}`}
                        className="text-muted-foreground text-sm"
                    >
                        {item.name} — реквізити: {item.accountsCount} шт,
                        рахунки: {item.invoicesCount} шт
                    </li>
                ))}
            </ul>
        </div>
    );
}

/**
 * Sprint 31 — видалення акаунта одним overlay у два кроки: спершу перелік того,
 * що зникне, з полями кількості, далі підтвердження (пароль або лист). Вкладені
 * модалки заборонені (`docs/conventions/overlays.md` §7), тож кроки живуть
 * усередині однієї.
 *
 * Лист летить звідси, а не з натискання кнопки у небезпечній зоні: жодна
 * руйнівна дія не чіпляється до самого натискання.
 */
export default function DeleteAccountDialog() {
    const router = useRouter();
    const isOpen = useDeleteAccountDialogStore((s) => s.isOpen);
    const preview = useDeleteAccountDialogStore((s) => s.preview);
    const close = useDeleteAccountDialogStore((s) => s.close);
    // Зайнятість живе у батька, бо саме він володіє закриттям вікна: Esc або
    // клік поза вікном під час підтвердження закрили б форму, тоді як запит уже
    // пішов — акаунт деактивувався б після «передумав», а відмову за невірним
    // паролем не було б куди показати.
    const [busy, setBusy] = useState(false);

    return (
        <UiModal
            open={isOpen && preview !== null}
            onOpenChange={(open) => {
                if (!open && !busy) close();
            }}
        >
            <UiModalContent>
                <UiModalHeader>
                    <UiModalTitle>Видалення акаунту</UiModalTitle>
                </UiModalHeader>
                {/* Radix демонтує Content на close, тож поля і пароль
                    скидаються самі на кожне відкриття — без setState-in-effect. */}
                {preview && (
                    <DeleteAccountForm
                        preview={preview}
                        busy={busy}
                        onBusyChange={setBusy}
                        onClose={close}
                        onDeleted={() => router.push('/auth/signin')}
                    />
                )}
            </UiModalContent>
        </UiModal>
    );
}

function DeleteAccountForm({
    preview,
    busy,
    onBusyChange,
    onClose,
    onDeleted,
}: {
    preview: AccountDeletionPreview;
    busy: boolean;
    onBusyChange: (busy: boolean) => void;
    onClose: () => void;
    onDeleted: () => void;
}) {
    const user = useAuthStore((s) => s.user);
    const setUser = useAuthStore((s) => s.setUser);
    const { totals } = preview;
    const { gates, words } = buildGates(totals);
    const [values, setValues] = useState<string[]>(() => gates.map(() => ''));
    // Шлях підтвердження приходить з переліком, але між його завантаженням і
    // натисканням людина могла встановити собі пароль (інша вкладка). Тоді
    // сервер листа не шле, і крок підтвердження мусить перемкнутись тут.
    const [confirmMethod, setConfirmMethod] =
        useState<AccountDeletionConfirmMethod>(preview.confirmMethod);

    const gatesPassed =
        gates.length === 0 || areDangerGatesSatisfied(gates, values);

    const form = useForm<DeleteAccountFormValues>({
        resolver: zodResolver(DeleteAccountFormSchema),
        defaultValues: { password: '' },
    });
    const { errors } = form.formState;

    const onSubmit = async (data: DeleteAccountFormValues) => {
        onBusyChange(true);
        try {
            await confirmDeleteAccount(data.password);
            onClose();
            toast.success('Акаунт деактивовано');
            onDeleted();
        } catch (err) {
            form.setError('password', {
                type: 'server',
                message: messageForError(err),
            });
        } finally {
            onBusyChange(false);
        }
    };

    const handleSendLink = async () => {
        onBusyChange(true);
        try {
            const result = await deleteUserAccount();
            // Відповідь розбирається, а не приймається на віру: сервер шле лист
            // лише тому, у кого пароля немає. Якщо пароль з'явився після
            // завантаження переліку, листа не буде — і сказати «посилання
            // надіслано» означало б відправити людину чекати на нього марно.
            if (!result.requiresMagicLink) {
                setConfirmMethod('password');
                toast.info(
                    'У вашому акаунті вже є пароль. Підтвердіть видалення паролем'
                );
                return;
            }
            if (user) {
                setUser({ ...user, accountDeletionRequestedAt: new Date() });
            }
            onClose();
            toast.success('Посилання надіслано на вашу пошту');
        } catch (err) {
            toast.error(messageForError(err));
        } finally {
            onBusyChange(false);
        }
    };

    return (
        <div className="px-4 pb-6">
            <p className="text-muted-foreground text-sm">
                {totals.businessesCount > 0
                    ? `Разом з акаунтом остаточно зникнуть отримувачі (${totals.businessesCount} шт) з усіма реквізитами (${totals.accountsCount} шт) та виставленими рахунками (${totals.invoicesCount} шт). Платіжні посилання і QR перестануть працювати одразу після підтвердження, дані буде видалено через 30 днів.`
                    : 'Ваш акаунт буде деактивовано. У вас буде 30 днів для відновлення.'}
            </p>

            <PayeeGroup title="Ваші отримувачі" items={preview.owned} />
            <PayeeGroup
                title="Отримувачі клієнтів"
                note="Їхні платіжні посилання перестануть працювати."
                items={preview.managed}
            />

            {gates.length > 0 && (
                <div className="mt-5">
                    <UiDangerGateFields
                        gates={gates}
                        values={values}
                        onChange={(index, value) =>
                            setValues((prev) => {
                                const next = [...prev];
                                next[index] = value;
                                return next;
                            })
                        }
                        renderPrompt={(input) => (
                            <>
                                Впишіть кількість{' '}
                                {gates.map((gate, index) => (
                                    <span key={gate.label}>
                                        {index > 0 &&
                                            (index === gates.length - 1
                                                ? ' і '
                                                : ', ')}
                                        {words[index]} {input(index)}
                                    </span>
                                ))}
                                , щоб підтвердити видалення.
                            </>
                        )}
                    />
                </div>
            )}

            {confirmMethod === 'password' ? (
                <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="mt-4 space-y-4"
                >
                    <UiPasswordInput
                        {...form.register('password', {
                            onChange: () => {
                                if (errors.password) {
                                    form.clearErrors('password');
                                }
                            },
                        })}
                        label="Введіть пароль для підтвердження"
                        error={errors.password?.message}
                        required
                        size="lg"
                        disabled={!gatesPassed}
                    />

                    <div className="flex justify-end gap-3">
                        <UiButton
                            type="button"
                            variant="text"
                            size="md"
                            onClick={onClose}
                            disabled={busy}
                        >
                            Скасувати
                        </UiButton>
                        <UiButton
                            type="submit"
                            variant="destructive-outline"
                            size="md"
                            loading={busy}
                            disabled={!gatesPassed}
                        >
                            Видалити акаунт
                        </UiButton>
                    </div>
                </form>
            ) : (
                <div className="mt-5 flex justify-end gap-3">
                    <UiButton
                        type="button"
                        variant="text"
                        size="md"
                        onClick={onClose}
                        disabled={busy}
                    >
                        Скасувати
                    </UiButton>
                    <UiButton
                        type="button"
                        variant="destructive-outline"
                        size="md"
                        loading={busy}
                        disabled={!gatesPassed}
                        onClick={() => void handleSendLink()}
                    >
                        Надіслати підтвердження на пошту
                    </UiButton>
                </div>
            )}
        </div>
    );
}

/**
 * `UNAUTHORIZED` тут означає саме невірний пароль (крок підтвердження), тому
 * розбирається окремо; решта кодів — спільна з небезпечною зоною.
 */
function messageForError(err: unknown): string {
    if (apiErrorCode(err) === 'UNAUTHORIZED') return 'Невірний пароль';
    return accountActionErrorMessage(err);
}
