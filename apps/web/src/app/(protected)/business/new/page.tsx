'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';

import {
    CLIENT_BUSINESS_LIMIT,
    evaluateClientBusinessCreation,
    evaluateOwnedBusinessCreation,
    type BusinessCreationVerdict,
    type BusinessType,
} from '@finly/types';
import { SubscribeActions } from '@/features/billing';
import {
    BusinessCreateForm,
    type BusinessCreateFormInitialValues,
} from '@/features/business-wizard';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';
import { useAccessLevel, useBookkeeperMode } from '@/entities/user';
import { listBusinesses } from '@/shared/api';
import { useHasHydrated } from '@/shared/lib';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import UiSpinner from '@/shared/ui/UiSpinner';
import UiUpsellNote from '@/shared/ui/UiUpsellNote';

/**
 * Sprint 10 §10.2 — `?from=landing` query-param активує recovery-flow після
 * failure POST1 anon-claim. На цьому шляху форма pre-fill-ається з landing-
 * draft (`receiverName → name`, `purpose → paymentPurposeTemplate`,
 * `taxId → taxId`, тип фіксовано як `individual` — той самий контракт, який
 * `QrPreviewInputSchema` накладає на anon-форму).
 *
 * Hydration-gate на `useQrLandingDraftStore.persist.hasHydrated()` (через
 * `useHasHydrated`) обов'язковий: landing-store hydrate-ується асинхронно з
 * localStorage; читання `getState().formData` до hydration віддасть порожній
 * shape. Skeleton до hydration-complete.
 *
 * **Sprint 19 ліміти — попередній гейтинг type-picker-а.** Сторінка тягне
 * список бізнесів поточного контексту (`own`/`client` за персистентним
 * `worksAsBookkeeper` — той самий прапор бекенд використає при create) і
 * обчислює вердикти через `evaluate*BusinessCreation` (`@finly/types` —
 * правила спільні з `assertWithinBusinessLimit` на API):
 *  - власний режим → per-тип вердикти у форму (disabled / upsell-картки);
 *  - режим бухгалтера на вичерпаному клієнт-ліміті → апсел замість форми;
 *  - fail фонового fetch-у → форма без гейтингу (deliberate degrade:
 *    попередження — це UX-зручність, фінальний арбітр — 403 сервера).
 */

type LimitsState =
    | { kind: 'loading' }
    | { kind: 'degraded' }
    | {
          kind: 'owned';
          typeVerdicts: Record<BusinessType, BusinessCreationVerdict>;
      }
    | { kind: 'client'; verdict: BusinessCreationVerdict };

function BusinessNewContent() {
    const searchParams = useSearchParams();
    const fromLanding = searchParams.get('from') === 'landing';
    const hasHydrated = useHasHydrated(useQrLandingDraftStore);
    const { isBookkeeper } = useBookkeeperMode();
    const accessLevel = useAccessLevel();

    const [limits, setLimits] = useState<LimitsState>({ kind: 'loading' });

    // Контекст явно у запиті (як на /business): read-after-write race з
    // паралельним PATCH `worksAsBookkeeper` не впливає на відповідь.
    const context = isBookkeeper ? 'client' : 'own';
    useEffect(() => {
        let cancelled = false;
        listBusinesses(context)
            .then((items) => {
                if (cancelled) return;
                if (context === 'client') {
                    setLimits({
                        kind: 'client',
                        verdict: evaluateClientBusinessCreation(
                            items.length,
                            accessLevel
                        ),
                    });
                    return;
                }
                const counts: Record<BusinessType, number> = {
                    individual: 0,
                    fop: 0,
                    tov: 0,
                    organization: 0,
                };
                for (const item of items) {
                    counts[item.type] += 1;
                }
                setLimits({
                    kind: 'owned',
                    typeVerdicts: {
                        individual: evaluateOwnedBusinessCreation(
                            'individual',
                            counts.individual,
                            accessLevel
                        ),
                        fop: evaluateOwnedBusinessCreation(
                            'fop',
                            counts.fop,
                            accessLevel
                        ),
                        tov: evaluateOwnedBusinessCreation(
                            'tov',
                            counts.tov,
                            accessLevel
                        ),
                        organization: evaluateOwnedBusinessCreation(
                            'organization',
                            counts.organization,
                            accessLevel
                        ),
                    },
                });
            })
            .catch(() => {
                // Deliberate degrade: гейтинг — UX-зручність, не enforcement.
                // Форма рендериться без вердиктів, ліміти зловить 403 API
                // (коди вже замаплені у UA-повідомлення).
                if (!cancelled) setLimits({ kind: 'degraded' });
            });
        return () => {
            cancelled = true;
        };
    }, [context, accessLevel]);

    const initialValues = useMemo<
        BusinessCreateFormInitialValues | undefined
    >(() => {
        if (!fromLanding || !hasHydrated) return undefined;
        const draft = useQrLandingDraftStore.getState().formData;
        // Landing-draft фіксує тип `individual`; якщо фізособа вже зайнята
        // (type-limit), pre-select впав би на disabled-картку — лишаємо тип
        // порожнім, картка сама пояснює причину, решта prefill зберігається.
        const individualBlocked =
            limits.kind === 'owned' && !limits.typeVerdicts.individual.allowed;
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

    if (limits.kind === 'client' && !limits.verdict.allowed) {
        return (
            <UiPageContainer className="space-y-6 py-10 md:py-14">
                <UiPageHeading className="md:text-4xl">
                    Створення отримувача
                </UiPageHeading>
                <ClientLimitReachedState />
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
                typeVerdicts={
                    limits.kind === 'owned' ? limits.typeVerdicts : undefined
                }
                planUpsell={
                    <UiUpsellNote
                        message="На поточному тарифі можна мати лише одного такого отримувача. Тариф «Агенція» знімає обмеження на кількість ТОВ та організацій"
                        actions={
                            <SubscribeActions
                                planCode="bookkeeper"
                                returnPath="/business/new"
                                exitHref="/business"
                                exitLabel="До отримувачів"
                            />
                        }
                    />
                }
            />
        </UiPageContainer>
    );
}

/**
 * Стан-екран замість форми: бухгалтер на none/brand вичерпав клієнт-ліміт.
 * Той самий візуальний патерн, що empty-state списку `/business` (іконка,
 * заголовок, пояснення, дії), щоб сторінка не виглядала глухим кутом з
 * одним рядком. Дії — спільний `SubscribeActions` (прямий checkout
 * «Агенції» з поверненням сюди / всі тарифи / вихід до списку).
 */
function ClientLimitReachedState() {
    return (
        <div className="border-border bg-card flex flex-col items-center gap-4 rounded-xl border p-10 text-center md:p-16">
            <div className="bg-muted text-muted-foreground flex size-16 items-center justify-center rounded-full">
                <Lock className="size-8" />
            </div>
            <div className="space-y-1">
                <h2 className="text-foreground text-lg font-semibold">
                    Ліміт отримувачів клієнтів вичерпано
                </h2>
                <p className="text-muted-foreground max-w-md text-sm">
                    На поточному тарифі можна вести до {CLIENT_BUSINESS_LIMIT}{' '}
                    отримувачів клієнтів. Тариф «Агенція» знімає це обмеження і
                    дозволяє вести необмежену кількість клієнтів.
                </p>
            </div>
            <div className="flex justify-center">
                <SubscribeActions
                    planCode="bookkeeper"
                    returnPath="/business/new"
                    exitHref="/business"
                    exitLabel="До отримувачів"
                />
            </div>
        </div>
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
