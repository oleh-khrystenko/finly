'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { type BusinessType } from '@finly/types';
import {
    BusinessCreateForm,
    type BusinessCreateFormInitialValues,
} from '@/features/business-wizard';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';
import { useBookkeeperMode } from '@/entities/user';
import { listBusinesses } from '@/shared/api';
import { useHasHydrated } from '@/shared/lib';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import UiSpinner from '@/shared/ui/UiSpinner';

/**
 * Sprint 10 §10.2 — `?from=landing` активує recovery-flow після failure POST1
 * anon-claim: форма pre-fill-ається з landing-draft (тип фіксовано `individual`).
 * Hydration-gate обов'язковий (landing-store hydrate-ується асинхронно).
 *
 * Sprint 27 — лімітів кількості бізнесів більше немає. Лишається лише доменний
 * інваріант «власна фізособа/ФОП по 1»: сторінка тягне власні бізнеси і, якщо
 * фізособа/ФОП уже є, disabl-ить відповідну картку типу. Клієнтський режим і
 * ТОВ/організації — безлімітні. Fail фонового fetch-у → форма без гейтингу
 * (сервер лишається фінальним арбітром через `BUSINESS_TYPE_LIMIT_REACHED`).
 */

type LimitsState =
    | { kind: 'loading' }
    | { kind: 'ready'; typeVerdicts?: Record<BusinessType, { allowed: boolean }> };

function BusinessNewContent() {
    const searchParams = useSearchParams();
    const fromLanding = searchParams.get('from') === 'landing';
    const hasHydrated = useHasHydrated(useQrLandingDraftStore);
    const { isBookkeeper } = useBookkeeperMode();

    const [limits, setLimits] = useState<LimitsState>({ kind: 'loading' });

    const context = isBookkeeper ? 'client' : 'own';
    useEffect(() => {
        let cancelled = false;
        // Клієнтський режим безлімітний — гейтинг типів не потрібен.
        if (context === 'client') {
            setLimits({ kind: 'ready' });
            return () => {
                cancelled = true;
            };
        }
        listBusinesses(context)
            .then((items) => {
                if (cancelled) return;
                const counts: Record<BusinessType, number> = {
                    individual: 0,
                    fop: 0,
                    tov: 0,
                    organization: 0,
                };
                for (const item of items) counts[item.type] += 1;
                setLimits({
                    kind: 'ready',
                    typeVerdicts: {
                        individual: { allowed: counts.individual === 0 },
                        fop: { allowed: counts.fop === 0 },
                        tov: { allowed: true },
                        organization: { allowed: true },
                    },
                });
            })
            .catch(() => {
                // Graceful degrade: форма без гейтингу; сервер зловить інваріант.
                if (!cancelled) setLimits({ kind: 'ready' });
            });
        return () => {
            cancelled = true;
        };
    }, [context]);

    const initialValues = useMemo<
        BusinessCreateFormInitialValues | undefined
    >(() => {
        if (!fromLanding || !hasHydrated) return undefined;
        const draft = useQrLandingDraftStore.getState().formData;
        // Landing-draft фіксує тип `individual`; якщо фізособа вже зайнята,
        // pre-select впав би на disabled-картку — лишаємо тип порожнім.
        const individualBlocked =
            limits.kind === 'ready' &&
            limits.typeVerdicts?.individual.allowed === false;
        return {
            type: individualBlocked ? undefined : 'individual',
            name: draft.receiverName,
            taxId: draft.taxId,
            paymentPurposeTemplate: draft.purpose,
        };
    }, [fromLanding, hasHydrated, limits]);

    if ((fromLanding && !hasHydrated) || limits.kind === 'loading') {
        return (
            <UiPageContainer className="space-y-6 py-10 md:py-14">
                <UiPageHeading className="md:text-4xl">
                    Створення отримувача
                </UiPageHeading>
                <div className="flex justify-center py-12">
                    <UiSpinner size="md" />
                </div>
            </UiPageContainer>
        );
    }

    return (
        <UiPageContainer className="space-y-6 py-10 md:py-14">
            <UiPageHeading className="md:text-4xl">
                Створення отримувача
            </UiPageHeading>
            <BusinessCreateForm
                initialValues={initialValues}
                fromLanding={fromLanding}
                typeVerdicts={limits.typeVerdicts}
            />
        </UiPageContainer>
    );
}

export default function BusinessNewPage() {
    return (
        <Suspense
            fallback={
                <UiPageContainer className="space-y-6 py-10 md:py-14">
                    <UiPageHeading className="md:text-4xl">
                        Створення отримувача
                    </UiPageHeading>
                    <div className="flex justify-center py-12">
                        <UiSpinner size="md" />
                    </div>
                </UiPageContainer>
            }
        >
            <BusinessNewContent />
        </Suspense>
    );
}
