'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, Trash2 } from 'lucide-react';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import {
    BUSINESS_TYPE_LABEL,
    type PublicBusinessView as PublicBusinessViewData,
    type UpdateBusinessRequest,
} from '@finly/types';
import {
    getApiMessage,
    getBusinessBySlug,
    getPublicBusinessView,
    updateBusiness,
    type BusinessWithInvoicesCount,
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
    hasTaxationFields,
    scheduleDeleteWithUndo,
    useDeleteBusinessConfirmStore,
} from '@/features/business-edit';
import { PublicBusinessView } from '@/features/business-public';
import { InvoicesSection, InvoicesSettingsSection } from '@/features/invoices';

// Discriminated union для prefetch-у public view. `slug` як discriminator
// дозволяє відрізнити "поточна версія" від stale-state, що приходить з
// fetch-у попереднього бізнесу при швидкому переході між кабінетами.
type PublicViewState =
    | { kind: 'idle' }
    | { kind: 'loaded'; slug: string; view: PublicBusinessViewData }
    | { kind: 'failed'; slug: string };

export default function BusinessSlugPage() {
    const router = useRouter();
    const params = useParams<{ slug: string }>();
    const openDeleteConfirm = useDeleteBusinessConfirmStore((s) => s.open);

    const [business, setBusiness] = useState<BusinessWithInvoicesCount | null>(
        null
    );
    const [error, setError] = useState<{ code: string } | null>(null);
    const [previewMode, setPreviewMode] = useState(false);
    const [publicView, setPublicView] = useState<PublicViewState>({
        kind: 'idle',
    });

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

    // Prefetch public view одразу після того, як cabinet `business` завантажений
    // — не чекаємо тапу `previewMode`-toggle. Re-fetch при кожному `business`
    // change (наприклад, після PATCH через `handlePatch`), щоб preview reflect-ив
    // свіжий name/acceptedBanks. State включає `slug` як discriminator: якщо
    // швидко перейти на інший бізнес, старий fetch завершиться з невідповідним
    // slug і panel розпізнає його як stale (показує spinner поки не прийде
    // правильна версія).
    useEffect(() => {
        if (!business) return;
        const slug = business.slug;
        let cancelled = false;
        getPublicBusinessView(slug)
            .then((view) => {
                if (!cancelled) setPublicView({ kind: 'loaded', slug, view });
            })
            .catch(() => {
                if (!cancelled) setPublicView({ kind: 'failed', slug });
            });
        return () => {
            cancelled = true;
        };
    }, [business]);

    const handlePatch = useCallback(
        async (patch: UpdateBusinessRequest) => {
            if (!business) return;
            try {
                const updated = await updateBusiness(business.slug, patch);
                // PATCH-endpoint повертає `Business` без `invoicesCount`
                // (counter не змінюється від settings-edit). Зберігаємо старе
                // значення, щоб delete-confirm-dialog не "втратив" cascade-warning.
                setBusiness({
                    ...updated,
                    invoicesCount: business.invoicesCount,
                });
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
        // Sprint 4 §SP-5 — передаємо `invoicesCount` у store, щоб
        // confirm-dialog показав warning-рядок ("У бізнесу N активних
        // рахунків — вони теж зникнуть") якщо counter > 0. Counter уже у
        // `BusinessWithInvoicesCount`-shape з cabinet-fetch-у §4.4.
        openDeleteConfirm(business, business.invoicesCount, () => {
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
                <BusinessPreviewPanel
                    state={publicView}
                    expectedSlug={business.slug}
                />
            ) : (
                <div className="space-y-4">
                    <BasicSection business={business} onSave={handlePatch} />
                    <RequisitesSection
                        business={business}
                        onSave={handlePatch}
                    />
                    {/*
                     * Sprint 7 §7.8 — TaxationSection рендериться лише для
                     * `fop` / `tov`. `hasTaxationFields` — composite guard:
                     *  1. **Type-driven primary**: `requiresTaxation(b.type)`
                     *     (truth у `BUSINESS_TYPES`-tuple) — єдиний drive для
                     *     render-decision. individual / organization не
                     *     render-яться навіть якщо документ має non-null
                     *     taxation (drift / data-corruption).
                     *  2. **Data-driven secondary**: non-null both fields —
                     *     TS-narrow до `TaxationCapableBusiness`-shape, що
                     *     потребує `Props`. Drift-fallthrough guard для legacy-
                     *     документів ФОП без taxation-полів.
                     *
                     * Conditional **unmount** (а не disabled) — UX-rationale
                     * §SP-7: для individual / organization не показуємо
                     * порожнє поле, а взагалі не рендеримо секцію.
                     */}
                    {hasTaxationFields(business) && (
                        <TaxationSection
                            business={business}
                            onSave={handlePatch}
                        />
                    )}
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
                    {/*
                     * Sprint 4 §4.4 §SP-4 — порядок 7,8,9 з 9 секцій.
                     * "Налаштування рахунків" перед "Рахунки" — patern
                     * "settings before content" (як "Публічна сторінка"
                     * перед "QR-картинка"). Danger zone завжди last.
                     */}
                    <InvoicesSettingsSection
                        business={business}
                        onSave={handlePatch}
                    />
                    <InvoicesSection
                        businessSlug={business.slug}
                        businessPaymentPurposeTemplate={
                            business.paymentPurposeTemplate
                        }
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

// Sprint 3 §3.8 §B2 — pure presentational. Public view prefetch-иться у
// parent одразу як cabinet `business` завантажений (не чекаючи `previewMode`-
// toggle), тож натиск toggle часто показує дані instant. `state.slug` ===
// `expectedSlug` перевірка ловить stale-state, що приходить з попереднього
// бізнесу при швидкому переході — поки prefetch для нового slug не дійде,
// показуємо spinner замість stale-даних попередньої вивіски.
function BusinessPreviewPanel({
    state,
    expectedSlug,
}: {
    state: PublicViewState;
    expectedSlug: string;
}) {
    const isCurrent = state.kind !== 'idle' && state.slug === expectedSlug;
    return (
        <div className="border-border bg-background rounded-xl border">
            {state.kind === 'loaded' && isCurrent ? (
                <PublicBusinessView
                    type={state.view.type}
                    name={state.view.name}
                    slug={state.view.slug}
                    acceptedBanks={state.view.acceptedBanks}
                    nbuLinks={state.view.nbuLinks}
                />
            ) : state.kind === 'failed' && isCurrent ? (
                <p className="text-muted-foreground p-8 text-center text-sm">
                    Не вдалося завантажити перегляд. Натисніть «Відкрити в новій
                    вкладці» для перевірки.
                </p>
            ) : (
                <div className="flex justify-center py-16">
                    <UiSpinner size="md" />
                </div>
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
