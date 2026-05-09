'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { AxiosError } from 'axios';
import {
    getApiMessage,
    getBusinessBySlug,
    type BusinessWithInvoicesCount,
} from '@/shared/api';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';
import UiButton from '@/shared/ui/UiButton';
import { CreateInvoiceForm } from '@/features/invoice-create';

/**
 * Sprint 4 §4.5 — route `/business/{slug}/invoice/new` для створення інвойсу.
 *
 * **Client Component** (sprint plan invariant — auth-token in-memory).
 * Fetch business у `useEffect` для prefilling default-preset
 * (`business.invoiceSlugPresetDefault ?? 'simple'`).
 *
 * **Route-discriminator** (review fix). `data: { paramSlug, business } | null`
 * — обʼєднує param-slug і fetched business у monolithic snapshot. При client-
 * side navigation між new-invoice-pages різних бізнесів (`/business/A/.../new`
 * → `/business/B/.../new`):
 *   - старий `data` лишається до завершення нового fetch — але render його
 *     **відкидає**, бо `paramSlug` ≠ `params.slug`. Користувач бачить spinner,
 *     не stale бізнес.
 *   - `<CreateInvoiceForm key={business.slug} />` — force-remount RHF, щоб
 *     `defaultValues` (slug preset, lock-state) перерахувалися під новий
 *     бізнес. Без `key` `useForm` ініціалізується один раз і draft
 *     попереднього бізнесу зберігається.
 *
 * Той самий патерн, що `/business/[slug]/invoice/[invoiceSlug]/page.tsx`
 * (Sprint 4 §4.6) — поведінка під race conditions узгоджена між сторінками.
 */
interface LoadedData {
    paramSlug: string;
    business: BusinessWithInvoicesCount;
}

interface ErrorState {
    paramSlug: string;
    message: string;
}

export default function NewInvoicePage() {
    const params = useParams<{ slug: string }>();
    const paramSlug = params.slug;
    const [data, setData] = useState<LoadedData | null>(null);
    const [error, setError] = useState<ErrorState | null>(null);

    useEffect(() => {
        if (!paramSlug) return;
        let cancelled = false;
        getBusinessBySlug(paramSlug)
            .then((b) => {
                if (cancelled) return;
                setData({ paramSlug, business: b });
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
                setError({
                    paramSlug,
                    message: getApiMessage(code, 'businesses'),
                });
            });
        return () => {
            cancelled = true;
        };
    }, [paramSlug]);

    const isDataCurrent = data?.paramSlug === paramSlug;
    const isErrorCurrent = error?.paramSlug === paramSlug;

    if (!isDataCurrent && !isErrorCurrent) {
        return (
            <UiPageContainer className="py-16">
                <div className="flex justify-center">
                    <UiSpinner size="md" />
                </div>
            </UiPageContainer>
        );
    }

    if (isErrorCurrent && error) {
        return (
            <UiPageContainer className="space-y-6 py-12">
                <UiSectionCard title={error.message}>
                    <p className="text-muted-foreground mt-2 text-sm">
                        Поверніться до бізнесу і повторіть.
                    </p>
                    <div className="mt-4">
                        <UiButton
                            as="link"
                            href="/business"
                            variant="filled"
                            size="md"
                            IconLeft={<ArrowLeft />}
                        >
                            До списку бізнесів
                        </UiButton>
                    </div>
                </UiSectionCard>
            </UiPageContainer>
        );
    }

    if (!isDataCurrent || !data) return null;
    const { business } = data;

    return (
        <UiPageContainer className="space-y-6 py-8 md:py-12">
            <UiButton
                as="link"
                href={`/business/${business.slug}#invoices`}
                variant="text"
                size="sm"
                IconLeft={<ArrowLeft />}
                className="self-start px-0"
            >
                Назад до бізнесу
            </UiButton>
            <UiPageHeading>Виставити рахунок</UiPageHeading>
            {/* `key={business.slug}` — force-remount RHF на business change.
                Без цього `useForm.defaultValues` ініціалізується раз, і
                slug-preset / amount-state попереднього бізнесу зберігаються
                після client-side navigation. */}
            <CreateInvoiceForm key={business.slug} business={business} />
        </UiPageContainer>
    );
}
