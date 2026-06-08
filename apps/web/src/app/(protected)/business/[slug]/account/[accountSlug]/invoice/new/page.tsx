'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { AxiosError } from 'axios';
import {
    getAccountBySlug,
    getApiMessage,
    getBusinessBySlug,
} from '@/shared/api';
import type { AccountWithCounts, BusinessWithCounts } from '@finly/types';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';
import UiButton from '@/shared/ui/UiButton';
import { CreateInvoiceForm } from '@/features/invoice-create';

/**
 * Sprint 9 §9.2 §SP-5 — route `/business/{slug}/account/{accountSlug}/invoice/
 * new` для створення інвойсу під рахунком. Матрьошка §SP-5 — invoice nested
 * під account.
 *
 * **Pre-fetch обидва: business + account** — business для
 * `paymentPurposeTemplate` (resolution для empty purpose у формі); account
 * для `invoiceSlugPresetDefault` (default option у dropdown).
 *
 * **Route-discriminator**: race-protection при швидкому навігації між
 * new-invoice-pages різних accounts/businesses (як Sprint 4 §4.5 patern).
 */

interface LoadedData {
    paramBiz: string;
    paramAcc: string;
    business: BusinessWithCounts;
    account: AccountWithCounts;
}

interface ErrorState {
    paramBiz: string;
    paramAcc: string;
    message: string;
}

export default function NewInvoicePage() {
    const params = useParams<{ slug: string; accountSlug: string }>();
    const paramBiz = params.slug;
    const paramAcc = params.accountSlug;
    const [data, setData] = useState<LoadedData | null>(null);
    const [error, setError] = useState<ErrorState | null>(null);

    useEffect(() => {
        if (!paramBiz || !paramAcc) return;
        let cancelled = false;
        Promise.all([
            getBusinessBySlug(paramBiz),
            getAccountBySlug(paramBiz, paramAcc),
        ])
            .then(([b, a]) => {
                if (cancelled) return;
                setData({ paramBiz, paramAcc, business: b, account: a });
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
                    paramBiz,
                    paramAcc,
                    message: getApiMessage(code, 'businesses'),
                });
            });
        return () => {
            cancelled = true;
        };
    }, [paramBiz, paramAcc]);

    const isDataCurrent =
        data?.paramBiz === paramBiz && data?.paramAcc === paramAcc;
    const isErrorCurrent =
        error?.paramBiz === paramBiz && error?.paramAcc === paramAcc;

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
                        Поверніться до реквізитів і повторіть.
                    </p>
                    <div className="mt-4">
                        <UiButton
                            as="link"
                            href="/business"
                            variant="filled"
                            size="md"
                            IconLeft={<ArrowLeft />}
                        >
                            До списку отримувачів
                        </UiButton>
                    </div>
                </UiSectionCard>
            </UiPageContainer>
        );
    }

    if (!isDataCurrent || !data) return null;
    const { business, account } = data;

    return (
        <UiPageContainer className="space-y-10 py-12 md:py-16">
            <UiButton
                as="link"
                href={`/business/${business.slug}/account/${account.slug}#invoices`}
                variant="text"
                size="sm"
                IconLeft={<ArrowLeft />}
                className="self-start px-0"
            >
                Назад до реквізитів
            </UiButton>
            <UiPageHeading className="md:text-4xl">
                Новий рахунок
            </UiPageHeading>
            {/*
             * `key={account.slug}` — force-remount RHF на account change.
             * Без цього `useForm.defaultValues` ініціалізується раз, і
             * slug-preset / amount-state попереднього рахунку зберігаються
             * після client-side navigation.
             */}
            <CreateInvoiceForm
                key={account.slug}
                business={business}
                account={account}
            />
        </UiPageContainer>
    );
}
