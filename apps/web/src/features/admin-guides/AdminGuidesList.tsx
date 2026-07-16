'use client';

import { useEffect, useState } from 'react';
import { Plus, FileText, AlertCircle } from 'lucide-react';
import type { AdminGuideListItem } from '@finly/types';

import UiButton from '@/shared/ui/UiButton';
import UiLink from '@/shared/ui/UiLink';
import UiSpinner from '@/shared/ui/UiSpinner';
import { adminListGuides } from '@/shared/api';

import { GuideStatusBadge } from './GuideStatusBadge';

const DATE_FMT = new Intl.DateTimeFormat('uk-UA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Kyiv',
});

type LoadState =
    | { phase: 'loading' }
    | { phase: 'error' }
    | { phase: 'ready'; items: AdminGuideListItem[] };

export function AdminGuidesList() {
    const [state, setState] = useState<LoadState>({ phase: 'loading' });

    useEffect(() => {
        let active = true;
        adminListGuides()
            .then((items) => {
                if (active) setState({ phase: 'ready', items });
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
                        Гайди
                    </h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Керування статтями розділу гайдів.
                    </p>
                </div>
                <UiButton
                    as="link"
                    href="/admin/guides/new"
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

                {state.phase === 'ready' && state.items.length === 0 && (
                    <div className="border-border bg-muted/40 mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border p-8 text-center">
                        <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg">
                            <FileText className="size-5" aria-hidden />
                        </span>
                        <p className="text-foreground text-sm font-medium">
                            Гайдів ще немає
                        </p>
                        <p className="text-muted-foreground text-sm">
                            Створіть перший гайд, щоб він зʼявився тут.
                        </p>
                    </div>
                )}

                {state.phase === 'ready' && state.items.length > 0 && (
                    <ul className="space-y-2">
                        {state.items.map((item) => (
                            <li key={item.id}>
                                <UiLink
                                    as="link"
                                    href={`/admin/guides/${item.id}`}
                                    variant="unstyled"
                                    className="group border-border bg-card hover:border-primary/40 hover:bg-muted/30 block rounded-xl border p-4 transition-colors"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-foreground truncate font-medium">
                                                {item.title}
                                            </p>
                                            <p className="text-muted-foreground mt-1 truncate text-sm">
                                                /{item.slug}
                                            </p>
                                        </div>
                                        <GuideStatusBadge
                                            status={item.status}
                                        />
                                    </div>
                                    <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                                        <span>
                                            {item.pillarSlug === null
                                                ? 'Основний гайд'
                                                : 'Розділ'}
                                        </span>
                                        <span aria-hidden>·</span>
                                        <span>
                                            Оновлено{' '}
                                            {DATE_FMT.format(
                                                new Date(item.updatedAt)
                                            )}
                                        </span>
                                    </div>
                                </UiLink>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </main>
    );
}
