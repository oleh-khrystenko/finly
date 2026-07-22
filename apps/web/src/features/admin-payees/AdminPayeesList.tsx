'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Landmark, Plus } from 'lucide-react';
import {
    BUSINESS_TYPE_LABEL,
    CATALOG_CATEGORY_LABEL,
    type Business,
} from '@finly/types';

import { adminListPayees } from '@/shared/api';
import { formatPayeeName } from '@/entities/business';
import UiButton from '@/shared/ui/UiButton';
import UiLink from '@/shared/ui/UiLink';
import UiSpinner from '@/shared/ui/UiSpinner';

type LoadState = { phase: 'loading' } | { phase: 'error' } | { phase: 'ready' };

export function AdminPayeesList() {
    const [state, setState] = useState<LoadState>({ phase: 'loading' });
    const [payees, setPayees] = useState<Business[]>([]);

    useEffect(() => {
        let active = true;
        adminListPayees()
            .then((loaded) => {
                if (!active) return;
                setPayees(loaded);
                setState({ phase: 'ready' });
            })
            .catch(() => {
                if (active) setState({ phase: 'error' });
            });
        return () => {
            active = false;
        };
    }, []);

    return (
        <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 md:py-14 lg:px-8">
            <header className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="text-foreground text-2xl font-semibold tracking-tight md:text-3xl">
                        Системні отримувачі
                    </h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Загальні отримувачі каталогу: податкова, фонди, збори.
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

                {state.phase === 'ready' && payees.length === 0 && (
                    <div className="border-border bg-muted/40 mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border p-8 text-center">
                        <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg">
                            <Landmark className="size-5" aria-hidden />
                        </span>
                        <p className="text-foreground text-sm font-medium">
                            Системних отримувачів ще немає
                        </p>
                        <p className="text-muted-foreground text-sm">
                            Створіть першого, щоб він зʼявився у публічному
                            каталозі.
                        </p>
                    </div>
                )}

                {state.phase === 'ready' && payees.length > 0 && (
                    <div className="space-y-2">
                        {payees.map((payee) => (
                            <PayeeRow key={payee.id} payee={payee} />
                        ))}
                    </div>
                )}
            </div>
        </main>
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
