'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import {
    isOnboardingComplete,
    QrPreviewInputSchema,
} from '@finly/types';

import { useAuthStore } from '@/entities/user';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';
import { getApiMessage } from '@/shared/api/mapApiCode';

import { claimLandingDraftAsBusiness } from './api';

/**
 * Sprint 8 §8.4 — пост-auth тригер для claim-у landing-draft-у.
 *
 * **Спрацьовує один раз**, коли всі чотири умови true:
 *   1. `isAuthenticated === true` — користувач завершив auth-flow.
 *   2. `isOnboardingComplete(user.profile)` — профіль повний.
 *      Sprint plan §8.4 critical gate: AuthGuard примусово редіректить
 *      incomplete-profile-користувача на `/profile?mode=new`. Backend
 *      `OnboardingInterceptor` блокує `POST /businesses/me` до завершення
 *      профілю. Hook чекає на цей флаг — після успішного PATCH `/users/me`
 *      authStore оновлюється, useEffect re-fires автоматично.
 *   3. `intent === 'claim-pending'` — користувач явно запросив claim
 *      натисканням "Зберегти у кабінет" на лендінгу.
 *   4. Не in-progress (race-protection через ref).
 *
 * **Race-protection через `inProgressRef`** (sprint plan §8.4): два render-и
 * підряд з тими самими (true, true, claim-pending) — API має викликатись один
 * раз. Without the ref, `useEffect` deps include `formData` (object identity
 * changes on every store update) → fires twice → дублікат бізнесу. ref
 * блокує другий вхід; success-path робить `clearAll()` (intent='idle'), тож
 * наступних effect-fires вже не буде.
 *
 * **Schema-drift guard через `safeParse`** (sprint plan §8.4): `formData`
 * у localStorage збережений при попередній версії застосунку; якщо схема
 * змінилась між версіями, persisted shape може не пройти `QrPreviewInputSchema`.
 * Тоді не викликаємо API (інакше backend reject-не з 400 без UA-копії),
 * а ставимо `intent='claim-failed'` + toast і даємо користувачу продовжити
 * з кабінету вручну.
 *
 * **Failure не очищає formData**: користувач не втрачає введене. Empty-state
 * списку бізнесів (Sprint 8.5 follow-up) читає `intent === 'claim-failed'`
 * і показує "Продовжити чернетку з лендінгу" CTA.
 */
export function useClaimLandingDraft(): void {
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const profile = useAuthStore((s) => s.user?.profile);
    const intent = useQrLandingDraftStore((s) => s.intent);
    const formData = useQrLandingDraftStore((s) => s.formData);
    const setIntent = useQrLandingDraftStore((s) => s.setIntent);
    const clearAll = useQrLandingDraftStore((s) => s.clearAll);
    const router = useRouter();
    const inProgressRef = useRef(false);

    const onboardingDone = profile ? isOnboardingComplete(profile) : false;

    useEffect(() => {
        if (!isAuthenticated) return;
        if (!onboardingDone) return;
        if (intent !== 'claim-pending') return;
        if (inProgressRef.current) return;

        const parsed = QrPreviewInputSchema.safeParse(formData);
        if (!parsed.success) {
            setIntent('claim-failed');
            toast.error(
                'Не вдалося відновити чернетку — створіть бізнес вручну'
            );
            return;
        }

        inProgressRef.current = true;
        claimLandingDraftAsBusiness(parsed.data)
            .then(({ slug }) => {
                clearAll();
                toast.success('Бізнес створено');
                router.replace(`/business/${slug}?completed-from=landing`);
            })
            .catch((err: unknown) => {
                inProgressRef.current = false;
                setIntent('claim-failed');
                const code =
                    err instanceof AxiosError
                        ? ((
                              err.response?.data as
                                  | { error?: { code?: string } }
                                  | undefined
                          )?.error?.code ?? 'unknown')
                        : 'unknown';
                toast.error(getApiMessage(code, 'businesses'));
            });
    }, [
        isAuthenticated,
        onboardingDone,
        intent,
        formData,
        setIntent,
        clearAll,
        router,
    ]);
}
