'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
    BANK_LABEL,
    BUSINESS_TYPE_LABEL,
    accountNameSchema,
    deriveAccountLabel,
    ibanZod,
    type AccountWithCounts,
    type Business,
} from '@finly/types';

import {
    adminCreatePayeeAccount,
    adminDeletePayee,
    adminDeletePayeeAccount,
    adminGetPayee,
    adminSetPayeeAccountCatalogVisibility,
    adminSetPayeeCatalogVisibility,
    extractApiErrorCode,
    getApiMessage,
} from '@/shared/api';
import { formatPayeeName } from '@/entities/business';
import UiBreadcrumb from '@/shared/ui/UiBreadcrumb';
import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';
import UiSwitch from '@/shared/ui/UiSwitch';

import { mapFieldMessage } from './fieldErrors';
import { useDeleteAdminPayeeAccountConfirmStore } from './deleteAdminPayeeAccountConfirmStore';
import { useDeleteAdminPayeeConfirmStore } from './deleteAdminPayeeConfirmStore';

type LoadState =
    | { phase: 'loading' }
    | { phase: 'error' }
    | { phase: 'ready'; business: Business; accounts: AccountWithCounts[] };

export function AdminPayeeDetail({ slug }: { slug: string }) {
    const router = useRouter();
    const openDeletePayeeConfirm = useDeleteAdminPayeeConfirmStore(
        (s) => s.open
    );
    const openDeleteAccountConfirm = useDeleteAdminPayeeAccountConfirmStore(
        (s) => s.open
    );
    const [state, setState] = useState<LoadState>({ phase: 'loading' });
    // Лок на БУДЬ-ЯКУ in-flight пару «мутація + reload()»: перемикачі
    // видимості, додавання і видалення реквізитів. Без нього дві швидкі дії
    // дають дві пари запит+GET, чиї відповіді можуть прийти не в тому порядку,
    // і пізніший `reload()` затирає UI знімком, зробленим до другої мутації.
    // Тому на час польоту блокуються ВСІ точки входу (тогли, «Додати»,
    // «Видалити»), не лише однотипні. Дзеркалить кабінетні `PublicitySection` /
    // `AccountCatalogSection`.
    const [mutationBusy, setMutationBusy] = useState(false);

    useEffect(() => {
        let active = true;
        adminGetPayee(slug)
            .then(({ business, accounts }) => {
                if (active) setState({ phase: 'ready', business, accounts });
            })
            .catch(() => {
                if (active) setState({ phase: 'error' });
            });
        return () => {
            active = false;
        };
    }, [slug]);

    if (state.phase === 'loading') {
        return (
            <UiPageContainer narrow>
                <div className="flex flex-1 items-center justify-center">
                    <UiSpinner size="md" />
                </div>
            </UiPageContainer>
        );
    }
    if (state.phase === 'error') {
        return (
            <UiPageContainer narrow className="justify-center">
                <UiSectionCard title="Отримувача не знайдено">
                    <div className="mt-4">
                        <UiButton
                            as="link"
                            href="/admin/payees"
                            variant="filled"
                            size="md"
                        >
                            До списку
                        </UiButton>
                    </div>
                </UiSectionCard>
            </UiPageContainer>
        );
    }

    const { business, accounts } = state;

    const reload = async () => {
        const fresh = await adminGetPayee(slug);
        setState({ phase: 'ready', ...fresh });
    };

    /**
     * Форма кладе будь-який throw звідси під своє поле і не чистить введене.
     * Тому за її межі виходить лише помилка САМОГО створення: збій наступного
     * перечитування списку інакше показувався б як «невалідний IBAN» на вже
     * створених реквізитах, і адмін тиснув би «Додати» вдруге.
     */
    const handleAddAccount = async (iban: string, name: string) => {
        // Помилка створення летить далі у форму (try/finally, без catch) — лок
        // при цьому знімається, а форма кладе повідомлення під своє поле.
        setMutationBusy(true);
        try {
            await adminCreatePayeeAccount(slug, {
                iban,
                ...(name.trim() ? { name: name.trim() } : {}),
            });
            toast.success('Реквізити додано');
            try {
                await reload();
            } catch (err) {
                toast.error(
                    getApiMessage(extractApiErrorCode(err), 'accounts')
                );
            }
        } finally {
            setMutationBusy(false);
        }
    };

    const deleteAccount = async (accountSlug: string) => {
        setMutationBusy(true);
        try {
            try {
                await adminDeletePayeeAccount(slug, accountSlug);
            } catch (err) {
                toast.error(
                    getApiMessage(extractApiErrorCode(err), 'accounts')
                );
                return;
            }
            // Успіх — одразу, як у handleAddAccount вище: збій наступного
            // перечитування інакше показувався б як провал видалення, і адмін
            // тиснув би «Видалити» вдруге на вже неіснуючих реквізитах.
            toast.success('Реквізити видалено');
            try {
                await reload();
            } catch (err) {
                toast.error(
                    getApiMessage(extractApiErrorCode(err), 'accounts')
                );
            }
        } finally {
            setMutationBusy(false);
        }
    };

    const requestDeleteAccount = (account: AccountWithCounts) => {
        openDeleteAccountConfirm(
            deriveAccountLabel({
                name: account.name,
                bankCode: account.bankCode,
                ibanMask: `•${account.iban.slice(-4)}`,
            }),
            () => void deleteAccount(account.slug)
        );
    };

    const handleToggleVisibility = async (visible: boolean) => {
        setMutationBusy(true);
        try {
            await adminSetPayeeCatalogVisibility(slug, visible);
            await reload();
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'businesses'));
        } finally {
            setMutationBusy(false);
        }
    };

    const handleToggleAccountVisibility = async (
        accountSlug: string,
        visible: boolean
    ) => {
        setMutationBusy(true);
        try {
            await adminSetPayeeAccountCatalogVisibility(
                slug,
                accountSlug,
                visible
            );
            await reload();
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'accounts'));
        } finally {
            setMutationBusy(false);
        }
    };

    const deletePayee = async () => {
        setMutationBusy(true);
        try {
            await adminDeletePayee(slug);
            toast.success('Отримувача видалено');
            router.push('/admin/payees');
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'businesses'));
        } finally {
            setMutationBusy(false);
        }
    };

    // Каскад зносить отримувача разом з усіма реквізитами, тому підтвердження
    // йде через gate-діалог: адмін вписує кількість вкладеного (CLAUDE.md
    // §Cascade-delete confirmation).
    const requestDeletePayee = () => {
        openDeletePayeeConfirm(
            formatPayeeName(business.type, business.name),
            accounts.length,
            () => void deletePayee()
        );
    };

    return (
        <UiPageContainer narrow className="space-y-6">
            <UiBreadcrumb
                items={[
                    { label: 'Системні отримувачі', href: '/admin/payees' },
                    { label: 'Отримувач' },
                ]}
            />
            <div className="flex flex-col gap-1">
                <p className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
                    {BUSINESS_TYPE_LABEL[business.type]}
                </p>
                <UiPageHeading className="break-words">
                    {formatPayeeName(business.type, business.name)}
                </UiPageHeading>
                <p className="text-muted-foreground mt-1 text-sm">
                    /{business.slug}
                </p>
                <div className="mt-3">
                    <UiButton
                        as="link"
                        href={`/admin/payees/${business.slug}/edit`}
                        variant="outline"
                        size="sm"
                        IconLeft={<Pencil className="size-4" />}
                    >
                        Редагувати
                    </UiButton>
                </div>
            </div>

            <UiSectionCard title="Каталог">
                <label
                    htmlFor="payee-catalog-toggle"
                    className="mt-2 flex cursor-pointer items-center justify-between gap-3"
                >
                    <span className="flex flex-col gap-0.5">
                        <span className="text-foreground text-base font-medium">
                            {business.catalogVisible
                                ? 'Показується в каталозі'
                                : 'Прихований з каталогу'}
                        </span>
                        <span className="text-muted-foreground text-sm">
                            Вмикайте видимість кожних реквізитів окремо нижче.
                        </span>
                    </span>
                    <UiSwitch
                        id="payee-catalog-toggle"
                        className="shrink-0"
                        checked={business.catalogVisible}
                        disabled={mutationBusy}
                        onChange={(next) => void handleToggleVisibility(next)}
                    />
                </label>
            </UiSectionCard>

            <UiSectionCard title="Реквізити">
                {accounts.length === 0 ? (
                    <p className="text-muted-foreground mt-2 text-sm">
                        Ще немає реквізитів. Додайте перші нижче.
                    </p>
                ) : (
                    <ul className="mt-4 space-y-2">
                        {accounts.map((account) => (
                            <AccountRow
                                key={account.id}
                                payeeSlug={business.slug}
                                account={account}
                                onDelete={() => requestDeleteAccount(account)}
                                actionsDisabled={mutationBusy}
                                onToggleVisibility={(visible) =>
                                    void handleToggleAccountVisibility(
                                        account.slug,
                                        visible
                                    )
                                }
                            />
                        ))}
                    </ul>
                )}
                <div className="border-border mt-5 border-t pt-5">
                    <AddAccountForm
                        onAdd={handleAddAccount}
                        disabled={mutationBusy}
                    />
                </div>
            </UiSectionCard>

            <UiSectionCard title="Небезпечна зона" variant="destructive">
                <p className="text-muted-foreground mt-2 text-sm">
                    Видалення повне: отримувач і всі його реквізити зникнуть з
                    каталогу і публічних сторінок.
                </p>
                <div className="mt-4">
                    <UiButton
                        type="button"
                        variant="destructive-outline"
                        size="md"
                        disabled={mutationBusy}
                        IconLeft={<Trash2 className="size-4" />}
                        onClick={requestDeletePayee}
                    >
                        Видалити отримувача
                    </UiButton>
                </div>
            </UiSectionCard>
        </UiPageContainer>
    );
}

function AccountRow({
    payeeSlug,
    account,
    onDelete,
    actionsDisabled,
    onToggleVisibility,
}: {
    payeeSlug: string;
    account: AccountWithCounts;
    onDelete: () => void;
    /** Спільний лок сторінки: під час будь-якої мутації дії рядка заблоковані. */
    actionsDisabled: boolean;
    onToggleVisibility: (visible: boolean) => void;
}) {
    const bankLabel =
        account.bankCode !== null ? BANK_LABEL[account.bankCode] : null;
    return (
        <li className="border-border bg-card flex flex-wrap items-center gap-3 rounded-xl border p-4">
            <div className="min-w-0 flex-1">
                <p className="text-foreground truncate font-medium">
                    {account.name ?? bankLabel ?? 'Реквізити'}
                </p>
                <p className="text-muted-foreground mt-0.5 truncate font-mono text-sm">
                    {account.iban}
                </p>
                <p className="text-muted-foreground mt-0.5 truncate text-sm">
                    /{account.slug}
                </p>
            </div>
            <label
                htmlFor={`account-catalog-toggle-${account.id}`}
                className="flex shrink-0 cursor-pointer items-center gap-2"
            >
                <span className="text-muted-foreground text-sm">
                    {account.catalogVisible ? 'У каталозі' : 'Приховано'}
                </span>
                <UiSwitch
                    id={`account-catalog-toggle-${account.id}`}
                    checked={account.catalogVisible}
                    disabled={actionsDisabled}
                    onChange={onToggleVisibility}
                />
            </label>
            <div className="flex shrink-0 items-center gap-2">
                <UiButton
                    as="link"
                    href={`/admin/payees/${payeeSlug}/accounts/${account.slug}/edit`}
                    variant="outline"
                    size="sm"
                    IconLeft={<Pencil className="size-4" />}
                >
                    Редагувати
                </UiButton>
                <UiButton
                    type="button"
                    variant="destructive-outline"
                    size="sm"
                    disabled={actionsDisabled}
                    IconLeft={<Trash2 className="size-4" />}
                    onClick={onDelete}
                >
                    Видалити
                </UiButton>
            </div>
        </li>
    );
}

function AddAccountForm({
    onAdd,
    disabled,
}: {
    onAdd: (iban: string, name: string) => Promise<void>;
    /** Спільний лок сторінки: поки летить інша мутація, сабміт заблоковано. */
    disabled: boolean;
}) {
    const [iban, setIban] = useState('');
    const [name, setName] = useState('');
    const [ibanError, setIbanError] = useState<string | undefined>();
    const [nameError, setNameError] = useState<string | undefined>();
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        const normalized = iban.replace(/\s/g, '').toUpperCase();
        const trimmedName = name.trim();
        setIbanError(undefined);
        setNameError(undefined);
        if (!ibanZod.safeParse(normalized).success) {
            setIbanError('Введіть коректний IBAN (UA + 27 цифр)');
            return;
        }
        // Назву перевіряємо на клієнті, бо з сервера field-format-помилки
        // приходять як generic `VALIDATION_ERROR` (`AllExceptionsFilter`
        // піднімає у власний код лише доменні coupled-rule-и), тобто поля-
        // винуватця у відповіді немає. Без цієї перевірки помилка назви осіла б
        // під IBAN — під справним полем. Патерн `EditableAccountName`.
        if (trimmedName !== '') {
            const parsedName = accountNameSchema.safeParse(trimmedName);
            if (!parsedName.success) {
                setNameError(
                    mapFieldMessage(parsedName.error.issues[0]!.message)
                );
                return;
            }
        }
        setBusy(true);
        try {
            await onAdd(normalized, trimmedName);
            setIban('');
            setName('');
        } catch (err) {
            // Назва вже перевірена вище, тож усе, що сервер ще може відхилити у
            // цьому запиті, стосується IBAN (дубль у межах отримувача,
            // невідомий банк-код).
            setIbanError(getApiMessage(extractApiErrorCode(err), 'accounts'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-3">
            <UiInput
                label="IBAN"
                value={iban}
                onChange={(e) => setIban(e.target.value)}
                error={ibanError}
                placeholder="UA000000000000000000000000000"
            />
            <UiInput
                label="Назва реквізитів (необовʼязково)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={nameError}
                placeholder="ЄСВ"
            />
            <UiButton
                type="button"
                variant="outline"
                size="md"
                loading={busy}
                disabled={disabled}
                IconLeft={<Plus className="size-4" />}
                onClick={() => void submit()}
            >
                Додати реквізити
            </UiButton>
        </div>
    );
}
