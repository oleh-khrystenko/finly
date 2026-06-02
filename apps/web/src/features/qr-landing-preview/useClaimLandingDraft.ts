'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
    isOnboardingComplete,
    LandingDraftSchema,
} from '@finly/types';

import { useAuthStore } from '@/entities/user';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';

import { runClaimChain } from './runClaimChain';

/**
 * Sprint 10 §10.2 — пост-auth тригер для 2-sequential anon-claim flow.
 *
 * **Sprint 8 → Sprint 10 еволюція**: Sprint 8 робив 1 POST на `/businesses/me`
 * з `requisites.iban` shape. Sprint 9 розщепив Business+Account; Sprint 10
 * замінює одиночний POST на 2-step chain (Business → Account) через спільний
 * `runClaimChain`-helper, що використовується і inline-CTA у
 * `QrLandingResult`.
 *
 * **Спрацьовує**, коли:
 *   1. `isAuthenticated === true` — користувач завершив auth-flow.
 *   2. `isOnboardingComplete(user.profile)` — backend `OnboardingInterceptor`
 *      блокує `POST /businesses/me` до завершення профілю.
 *   3. `intent === 'claim-pending'` — користувач явно запросив claim
 *      натисканням "Зберегти у кабінет".
 *   4. `claimIdempotencyKey` непорожній (sanity).
 *   5. Не in-progress (`inProgressRef`).
 *
 * **Tab-close mid-flight resumption** (Sprint 10 §SP-7): persisted `intent ∈
 * {'claim-business-pending', 'claim-account-pending'}` означає, що попередня
 * сесія crash-нула посеред 2-step flow. `inProgressRef` НЕ переживає mount-
 * цикл; auto-retry без `claimIdempotencyKey` створив би дублікат. Recovery-
 * gate **mount-only** (через snapshot `getState().intent` у `[]`-deps effect):
 * перевіряємо стан рівно на mount, а не реагуємо на live-transition. Без
 * mount-only-gate effect re-fired би при legitimate `setIntent('claim-
 * business-pending')` всередині `runClaimChain` і показував би false-positive
 * recovery-toast одразу перед success-toast того самого claim-flow.
 *
 * **Race-protection через `inProgressRef`**: store-updates (`formData` у deps)
 * можуть re-fire-нути effect; ref блокує другий вхід.
 *
 * **Schema-drift guard через `safeParse`**: `formData` у localStorage міг
 * лежати ще від попередньої версії застосунку.
 */
export function useClaimLandingDraft(): void {
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const profile = useAuthStore((s) => s.user?.profile);
    const intent = useQrLandingDraftStore((s) => s.intent);
    const formData = useQrLandingDraftStore((s) => s.formData);
    const claimIdempotencyKey = useQrLandingDraftStore(
        (s) => s.claimIdempotencyKey
    );
    const setIntent = useQrLandingDraftStore((s) => s.setIntent);
    const setFormData = useQrLandingDraftStore((s) => s.setFormData);
    const clearAll = useQrLandingDraftStore((s) => s.clearAll);
    const router = useRouter();
    const inProgressRef = useRef(false);

    const onboardingDone = profile ? isOnboardingComplete(profile) : false;

    // Sprint 10 §SP-7 — mount-only resumption-gate. Snapshot intent on mount
    // через `getState()` (не reactive selector). Якщо persisted значення вже
    // *-pending з попередньої crash-нутої сесії — reset на 'idle' + info-toast,
    // user тригерить retry свідомо. **Не реагує на live setIntent** під час
    // in-flight claim — інакше main-effect нижче, перейшовши у
    // 'claim-business-pending', тригернув би лжетост на тому самому
    // успішному flow.
    useEffect(() => {
        const persistedIntent = useQrLandingDraftStore.getState().intent;
        if (
            persistedIntent === 'claim-business-pending' ||
            persistedIntent === 'claim-account-pending'
        ) {
            useQrLandingDraftStore.getState().setIntent('idle');
            toast.info(
                'Збереження було перервано. Натисніть «Зберегти у кабінет» ще раз'
            );
        }
    }, []);

    useEffect(() => {
        if (!isAuthenticated) return;
        if (!onboardingDone) return;
        if (intent !== 'claim-pending') return;
        if (!claimIdempotencyKey) return;
        if (inProgressRef.current) return;

        const parsed = LandingDraftSchema.safeParse(formData);
        if (!parsed.success) {
            setIntent('claim-failed-business');
            toast.error(
                'Не вдалося відновити чернетку. Створіть бізнес вручну'
            );
            return;
        }

        inProgressRef.current = true;
        void runClaimChain(parsed.data, claimIdempotencyKey, {
            setIntent,
            setFormData,
            clearAll,
            router,
        }).finally(() => {
            inProgressRef.current = false;
        });
    }, [
        isAuthenticated,
        onboardingDone,
        intent,
        formData,
        claimIdempotencyKey,
        setIntent,
        setFormData,
        clearAll,
        router,
    ]);
}
