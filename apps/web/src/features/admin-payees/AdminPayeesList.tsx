'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    AlertCircle,
    BadgeCheck,
    ExternalLink,
    Landmark,
    Plus,
} from 'lucide-react';
import {
    BUSINESS_TYPE_LABEL,
    CATALOG_CATEGORY_LABEL,
    type Business,
} from '@finly/types';

import { adminListApprovedPublicity, adminListPayees } from '@/shared/api';
import { formatPayeeName } from '@/entities/business';
import { ENV } from '@/shared/config/env';
import UiButton from '@/shared/ui/UiButton';
import UiLink from '@/shared/ui/UiLink';
import UiSpinner from '@/shared/ui/UiSpinner';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import { AdminCatalogTabs } from './AdminCatalogTabs';
import { useRejectPublicityStore } from './rejectPublicityStore';

type LoadState = { phase: 'loading' } | { phase: 'error' } | { phase: 'ready' };

export function AdminPayeesList() {
    const [state, setState] = useState<LoadState>({ phase: 'loading' });
    // Два джерела одного каталогу: системні (заведені адміном руками) і схвалені
    // заявки користувачів. Тримаємо окремо, бо картки і дії різні, а бейдж
    // «Схвалено» має відрізнити впущеного від створеного.
    const [systemPayees, setSystemPayees] = useState<Business[]>([]);
    const [approved, setApproved] = useState<Business[]>([]);
    const openReject = useRejectPublicityStore((s) => s.open);

    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const load = useCallback(() => {
        Promise.all([adminListPayees(), adminListApprovedPublicity()])
            .then(([system, approvedList]) => {
                if (!mountedRef.current) return;
                setSystemPayees(system);
                setApproved(approvedList);
                setState({ phase: 'ready' });
            })
            .catch(() => {
                if (mountedRef.current) setState({ phase: 'error' });
            });
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const total = systemPayees.length + approved.length;

    return (
        <UiPageContainer>
            <AdminCatalogTabs />

            <header className="flex items-center justify-between gap-4">
                <div>
                    <UiPageHeading>Отримувачі каталогу</UiPageHeading>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Системні отримувачі та схвалені заявки, що показуються в
                        каталозі.
                    </p>
                </div>
                <UiButton
                    as="link"
                    href="/admin/payees/new"
                    variant="filled"
                    size="md"
                    IconLeft={<Plus className="size-4" />}
                >
                    Створити
                </UiButton>
            </header>

            <div className="mt-8">
                {state.phase === 'loading' && (
                    <div className="flex justify-center py-16">
                        <UiSpinner size="lg" />
                    </div>
                )}

                {state.phase === 'error' && (
                    <div className="border-border bg-muted/40 text-muted-foreground flex items-center gap-3 rounded-xl border p-5 text-sm">
                        <AlertCircle className="size-5 shrink-0" aria-hidden />
                        Не вдалося завантажити список. Перезавантажте сторінку.
                    </div>
                )}

                {state.phase === 'ready' && total === 0 && (
                    <div className="border-border bg-muted/40 mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border p-8 text-center">
                        <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg">
                            <Landmark className="size-5" aria-hidden />
                        </span>
                        <p className="text-foreground text-sm font-medium">
                            У каталозі поки нікого
                        </p>
                        <p className="text-muted-foreground text-sm">
                            Створіть системного отримувача або схваліть заявку у
                            вкладці «Запити».
                        </p>
                    </div>
                )}

                {state.phase === 'ready' && total > 0 && (
                    <div className="space-y-2">
                        {systemPayees.map((payee) => (
                            <PayeeRow key={payee.id} payee={payee} />
                        ))}
                        {approved.map((payee) => (
                            <ApprovedRow
                                key={payee.id}
                                payee={payee}
                                onRevoke={() =>
                                    openReject({
                                        slug: payee.slug,
                                        payeeName: formatPayeeName(
                                            payee.type,
                                            payee.name
                                        ),
                                        mode: 'approved',
                                        onRejected: load,
                                    })
                                }
                            />
                        ))}
                    </div>
                )}
            </div>
        </UiPageContainer>
    );
}

function PayeeRow({ payee }: { payee: Business }) {
    return (
        <UiLink
            as="link"
            href={`/admin/payees/${payee.slug}`}
            variant="unstyled"
            className="group border-border bg-card hover:border-primary/40 block rounded-xl border p-4 transition-colors"
        >
            <p className="text-foreground group-hover:text-primary truncate font-medium transition-colors">
                {formatPayeeName(payee.type, payee.name)}
            </p>
            <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span>{BUSINESS_TYPE_LABEL[payee.type]}</span>
                <span aria-hidden>·</span>
                <span>{CATALOG_CATEGORY_LABEL[payee.catalogCategory]}</span>
                <span aria-hidden>·</span>
                <span>/{payee.slug}</span>
                {!payee.catalogVisible && (
                    <>
                        <span aria-hidden>·</span>
                        <span>прихований</span>
                    </>
                )}
            </div>
        </UiLink>
    );
}

/**
 * Рядок схваленої заявки. На відміну від системного отримувача, запис належить
 * користувачу, тож адмін його не редагує (нема лінка в CRUD) — лише переглядає
 * публічну сторінку і за потреби забирає з каталогу. Бейдж «Схвалено» — суто
 * адмінський маркер походження, у публічний каталог не потрапляє.
 */
function ApprovedRow({
    payee,
    onRevoke,
}: {
    payee: Business;
    onRevoke: () => void;
}) {
    const publicUrl = `${ENV.NEXT_PUBLIC_PAY_PUBLIC_URL.replace(/\/$/, '')}/${payee.slug}`;
    return (
        <div className="border-border bg-card flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
            <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                    <p className="text-foreground truncate font-medium">
                        {formatPayeeName(payee.type, payee.name)}
                    </p>
                    <span className="bg-success/10 text-success inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
                        <BadgeCheck className="size-3.5" aria-hidden />
                        Схвалено
                    </span>
                </div>
                <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span>{CATALOG_CATEGORY_LABEL[payee.catalogCategory]}</span>
                    <span aria-hidden>·</span>
                    <span>
                        {payee.catalogVisible
                            ? 'Показується в каталозі'
                            : 'Приховано власником'}
                    </span>
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
                <UiLink
                    as="a"
                    href={publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="unstyled"
                    aria-label="Відкрити публічну сторінку в новій вкладці"
                    className="text-muted-foreground hover:text-primary inline-flex items-center gap-1 text-sm transition-colors"
                >
                    Переглянути
                    <ExternalLink className="size-4" aria-hidden />
                </UiLink>
                <UiButton
                    type="button"
                    variant="destructive-outline"
                    size="sm"
                    onClick={onRevoke}
                >
                    Прибрати з каталогу
                </UiButton>
            </div>
        </div>
    );
}
