'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { AxiosError } from 'axios';
import {
    getApiMessage,
    getBusinessBySlug,
} from '@/shared/api';
import type { BusinessWithCounts } from '@finly/types';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';
import UiButton from '@/shared/ui/UiButton';
import { AccountCreateForm } from '@/features/account-create';

/**
 * Sprint 9 §9.2 — route `/business/{slug}/account/new`. Single-form для
 * створення Account під бізнесом.
 *
 * **Pre-fetch business**: щоб переконатися, що `BusinessAccessGuard` пропустить
 * наступний POST. Помилка fetch-у — ErrorPage; success — render form з
 * `businessSlug`-prop-ом.
 */
interface LoadedData {
    paramSlug: string;
    business: BusinessWithCounts;
}

interface ErrorState {
    paramSlug: string;
    message: string;
}

export default function NewAccountPage() {
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
                href={`/business/${business.slug}`}
                variant="text"
                size="sm"
                IconLeft={<ArrowLeft />}
                className="self-start px-0"
            >
                Назад до бізнесу
            </UiButton>
            <UiPageHeading>Додати рахунок</UiPageHeading>
            <AccountCreateForm businessSlug={business.slug} />
        </UiPageContainer>
    );
}
