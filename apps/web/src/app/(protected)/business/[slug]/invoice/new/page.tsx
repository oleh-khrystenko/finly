'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
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
 */
export default function NewInvoicePage() {
    const params = useParams<{ slug: string }>();
    const [business, setBusiness] = useState<
        BusinessWithInvoicesCount | null
    >(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!params.slug) return;
        let cancelled = false;
        getBusinessBySlug(params.slug)
            .then((b) => {
                if (cancelled) return;
                setBusiness(b);
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
                setError(getApiMessage(code, 'businesses'));
            });
        return () => {
            cancelled = true;
        };
    }, [params.slug]);

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
        return (
            <UiPageContainer className="space-y-6 py-12">
                <UiSectionCard title={error}>
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

    if (!business) return null;

    return (
        <UiPageContainer className="space-y-6 py-8 md:py-12">
            <Link
                href={`/business/${business.slug}#invoices`}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
            >
                <ArrowLeft className="size-4" />
                Назад до бізнесу
            </Link>
            <UiPageHeading>Виставити рахунок</UiPageHeading>
            <CreateInvoiceForm business={business} />
        </UiPageContainer>
    );
}
