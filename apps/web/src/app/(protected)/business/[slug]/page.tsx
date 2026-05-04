'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, Trash2 } from 'lucide-react';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import {
    BUSINESS_TYPE_LABEL,
    type Business,
    type PublicBusinessView as PublicBusinessViewData,
    type UpdateBusinessRequest,
} from '@finly/types';
import {
    getApiMessage,
    getBusinessBySlug,
    getPublicBusinessView,
    updateBusiness,
} from '@/shared/api';
import { ENV } from '@/shared/config/env';
import UiButton from '@/shared/ui/UiButton';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';
import UiSwitch from '@/shared/ui/UiSwitch';
import {
    BasicSection,
    BanksSection,
    PublicSection,
    QrSection,
    RequisitesSection,
    TaxationSection,
    scheduleDeleteWithUndo,
    useDeleteBusinessConfirmStore,
} from '@/features/business-edit';
import { PublicBusinessView } from '@/features/business-public';

export default function BusinessSlugPage() {
    const router = useRouter();
    const params = useParams<{ slug: string }>();
    const openDeleteConfirm = useDeleteBusinessConfirmStore((s) => s.open);

    const [business, setBusiness] = useState<Business | null>(null);
    const [error, setError] = useState<{ code: string } | null>(null);
    const [previewMode, setPreviewMode] = useState(false);

    // State-mutation тільки в .then/.catch async-callback-ах — синхронний
    // reset перед fetch порушує react-hooks/set-state-in-effect (React 19).
    // Stale data залишається видимою під час фонового re-fetch при зміні slug
    // (Linear-style); initial mount — `business === null` показує спінер до
    // першої відповіді.
    useEffect(() => {
        if (!params.slug) return;
        let cancelled = false;
        getBusinessBySlug(params.slug)
            .then((fetched) => {
                if (cancelled) return;
                setBusiness(fetched);
                setError(null);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                const code =
                    err instanceof AxiosError
                        ? ((
                              err.response?.data as
                                  | { error?: { code?: string } }
                                  | undefined
                          )?.error?.code ?? 'unknown')
                        : 'unknown';
                setError({ code });
            });
        return () => {
            cancelled = true;
        };
    }, [params.slug]);

    const handlePatch = useCallback(
        async (patch: UpdateBusinessRequest) => {
            if (!business) return;
            try {
                const updated = await updateBusiness(business.slug, patch);
                setBusiness(updated);
                toast.success('Зміни збережено');
            } catch (err) {
                const code =
                    err instanceof AxiosError
                        ? ((
                              err.response?.data as
                                  | { error?: { code?: string } }
                                  | undefined
                          )?.error?.code ?? 'unknown')
                        : 'unknown';
                const msg = getApiMessage(code, 'businesses');
                toast.error(msg);
                throw new Error(msg);
            }
        },
        [business]
    );

    const handleDelete = useCallback(() => {
        if (!business) return;
        const slug = business.slug;
        const name = business.name;
        openDeleteConfirm(business, () => {
            scheduleDeleteWithUndo({
                slug,
                name,
                onScheduled: () => router.replace('/business'),
                onCancelled: () => router.replace(`/business/${slug}`),
            });
        });
    }, [business, openDeleteConfirm, router]);

    if (business === null && !error) {
        return (
            <UiPageContainer className="py-16">
                <div className="flex justify-center">
                    <UiSpinner size="md" />
                </div>
            </UiPageContainer>
        );
    }

    if (error) {
        return <ErrorPage code={error.code} />;
    }

    if (!business) return null;

    const publicUrl = `${ENV.NEXT_PUBLIC_PAY_PUBLIC_URL.replace(/\/$/, '')}/${business.slug}`;
    const heading = `${BUSINESS_TYPE_LABEL[business.type]} ${business.name}`;

    return (
        <UiPageContainer className="space-y-6 py-8 md:py-12">
            {/* Top toolbar: back-link, heading, preview-toggle, open-tab. */}
            <div className="flex flex-col gap-4">
                <Link
                    href="/business"
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
                >
                    <ArrowLeft className="size-4" />
                    Назад до списку
                </Link>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <h1 className="text-foreground text-2xl font-bold tracking-tight md:text-3xl">
                        {heading}
                    </h1>
                    <div className="flex flex-wrap items-center gap-3">
                        <label
                            htmlFor="preview-toggle"
                            className="flex cursor-pointer items-center gap-2"
                        >
                            <UiSwitch
                                id="preview-toggle"
                                size="sm"
                                checked={previewMode}
                                onChange={setPreviewMode}
                            />
                            <span className="text-muted-foreground text-sm">
                                Перегляд як клієнт
                            </span>
                        </label>
                        <UiButton
                            as="a"
                            href={publicUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            variant="outline"
                            size="sm"
                            IconRight={<ExternalLink />}
                        >
                            Відкрити в новій вкладці
                        </UiButton>
                    </div>
                </div>
            </div>

            {/* Body: preview vs edit. */}
            {previewMode ? (
                <BusinessPreviewPanel business={business} />
            ) : (
                <div className="space-y-4">
                    <BasicSection business={business} onSave={handlePatch} />
                    <RequisitesSection
                        business={business}
                        onSave={handlePatch}
                    />
                    <TaxationSection business={business} onSave={handlePatch} />
                    <BanksSection business={business} onSave={handlePatch} />
                    <PublicSection
                        business={business}
                        payPublicOrigin={ENV.NEXT_PUBLIC_PAY_PUBLIC_URL}
                        onSave={handlePatch}
                    />
                    <QrSection
                        business={business}
                        payPublicOrigin={ENV.NEXT_PUBLIC_PAY_PUBLIC_URL}
                    />

                    {/* Danger zone */}
                    <UiSectionCard title="Небезпечна зона">
                        <p className="text-muted-foreground mt-2 text-sm">
                            Видалення повне і незворотне. Клієнти, які мають
                            збережене посилання, не зможуть оплатити.
                        </p>
                        <div className="mt-4">
                            <UiButton
                                type="button"
                                variant="destructive-outline"
                                size="md"
                                onClick={handleDelete}
                                IconLeft={<Trash2 />}
                            >
                                Видалити бізнес
                            </UiButton>
                        </div>
                    </UiSectionCard>
                </div>
            )}
        </UiPageContainer>
    );
}

// Sprint 3 §3.8 §B2 — preview-toggle fetch-ить public view (з nbuLinks для
// функціональних CTA). Окремий fetch, бо cabinet endpoint навмисно не
// повертає nbuLinks (whitelist розділяє auth-зону і public-зону).
//
// Винесено в окремий компонент із власним state замість inline-effect-а у
// parent: mount/unmount керується `previewMode`-toggle-ом, тож state має
// чистий lifecycle і всі setState — у async-callback-ах (lint-rule
// react-hooks/set-state-in-effect стосується тільки synchronous setState
// у effect body, що було в попередній inline-версії).
type PreviewState =
    | { kind: 'loading' }
    | { kind: 'loaded'; view: PublicBusinessViewData }
    | { kind: 'failed' };

function BusinessPreviewPanel({ business }: { business: Business }) {
    const [state, setState] = useState<PreviewState>({ kind: 'loading' });

    useEffect(() => {
        let cancelled = false;
        getPublicBusinessView(business.slug)
            .then((v) => {
                if (!cancelled) setState({ kind: 'loaded', view: v });
            })
            .catch(() => {
                if (!cancelled) setState({ kind: 'failed' });
            });
        return () => {
            cancelled = true;
        };
    }, [business.slug]);

    return (
        <div className="border-border bg-background rounded-xl border">
            {state.kind === 'loaded' ? (
                <PublicBusinessView
                    type={state.view.type}
                    name={state.view.name}
                    slug={state.view.slug}
                    acceptedBanks={state.view.acceptedBanks}
                    nbuLinks={state.view.nbuLinks}
                />
            ) : state.kind === 'loading' ? (
                <div className="flex justify-center py-16">
                    <UiSpinner size="md" />
                </div>
            ) : (
                <p className="text-muted-foreground p-8 text-center text-sm">
                    Не вдалося завантажити перегляд. Натисніть «Відкрити в новій
                    вкладці» для перевірки.
                </p>
            )}
        </div>
    );
}

function ErrorPage({ code }: { code: string }) {
    const message =
        code === 'BUSINESS_NOT_FOUND' || code === 'NOT_FOUND'
            ? 'Бізнес не знайдено'
            : code === 'BUSINESS_ACCESS_DENIED'
              ? 'У вас немає доступу до цього бізнесу'
              : getApiMessage(code, 'businesses');

    return (
        <UiPageContainer className="space-y-6 py-12">
            <UiSectionCard title={message}>
                <p className="text-muted-foreground mt-2 text-sm">
                    Поверніться до списку бізнесів і оберіть інший.
                </p>
                <div className="mt-4">
                    <UiButton
                        as="link"
                        href="/business"
                        variant="filled"
                        size="md"
                        IconLeft={<ArrowLeft />}
                    >
                        Повернутись до моїх бізнесів
                    </UiButton>
                </div>
            </UiSectionCard>
        </UiPageContainer>
    );
}
