'use client';

import { useEffect } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
    QrPreviewInputSchema,
    type QrPreviewInput,
} from '@finly/types';

import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';

import { QrLandingForm } from './QrLandingForm';
import { QrLandingResult } from './QrLandingResult';
import { useHasHydrated } from './lib/useHasHydrated';

/**
 * Sprint 8 §8.3 — orchestrator: тримає `useForm`-instance, persist-bridge,
 * hydration gate; передає form у обидва child-компоненти.
 *
 * **Чому form lift-нутий у Block, а не власний у Form**: дві причини.
 *
 *  1. **`form.reset()` для "Очистити"** (sprint plan §8.3 explicit). Кнопка
 *     живе у `QrLandingResult`, форма — у `QrLandingForm`. Без spilling-у
 *     form-instance через спільного предка clear-action скидав би store, але
 *     `<input>`-и зберігали б values (RHF uncontrolled, `defaultValues` frozen
 *     на mount). Користувач натиснув "Очистити" → бачив дані → bug.
 *
 *  2. **Hydration sync** (UAT LAND-3 explicit). Zustand `persist` гідратує
 *     localStorage асинхронно ПІСЛЯ першого render. Якщо `useForm` живе у
 *     Form і читає persisted snapshot як `defaultValues` через `getState()` —
 *     snapshot frozen на момент init → перший render бачить порожні values,
 *     hydration не propagates. Lift-нутий form + `useHasHydrated`-gate
 *     гарантує, що form-instance створюється лише ПІСЛЯ hydration з повним
 *     persisted-snapshot як `defaultValues`. Жодного reset-у з useEffect-loop.
 *
 * **`'use client'`** обов'язковий: form-state, store-snapshot, hydration-gate.
 *
 * **Skeleton під час hydration** — fixed-height grid, що не зміщує hero
 * вище. CLS-safe.
 */
export function QrLandingBlock() {
    const hasHydrated = useHasHydrated(useQrLandingDraftStore);

    // Header (h2 + intro) рендериться завжди — статичний, не залежить від
    // hydration. Це робить SSR-snapshot meaningful (для SEO crawl-у на
    // landing). Інтерактивна частина (form + result) gate-ться на hasHydrated.
    return (
        <section
            id="try-now"
            aria-labelledby="try-now-heading"
            className="container mx-auto px-6 py-16"
        >
            <div className="mb-10 max-w-2xl">
                <h2
                    id="try-now-heading"
                    className="text-3xl font-semibold tracking-tight"
                >
                    Спробуйте прямо зараз
                </h2>
                <p className="text-muted-foreground mt-3 text-base">
                    Введіть реквізити — система згенерує QR-код за стандартом
                    НБУ, який відкривається в будь-якому банк-додатку України.
                </p>
            </div>
            {hasHydrated ? (
                <HydratedContent />
            ) : (
                <BlockSkeleton aria-label="Завантажуємо форму…" />
            )}
        </section>
    );
}

/**
 * Form-state + persist-subscription живуть тут, бо створюються лише ПІСЛЯ
 * hydration. Запобігає infinite-loop-у `form.reset()` з useEffect (frozen
 * snapshot з persistedFormData на створення `useForm` коректний).
 */
function HydratedContent() {
    const persistedFormData = useQrLandingDraftStore.getState().formData;
    const setFormData = useQrLandingDraftStore((s) => s.setFormData);
    const invalidateResult = useQrLandingDraftStore((s) => s.invalidateResult);

    const form = useForm<QrPreviewInput>({
        resolver: zodResolver(QrPreviewInputSchema),
        mode: 'onChange',
        defaultValues: {
            receiverName: persistedFormData.receiverName ?? '',
            iban: persistedFormData.iban ?? '',
            taxId: persistedFormData.taxId ?? '',
            purpose: persistedFormData.purpose ?? 'Поповнення рахунку',
        },
    });

    // Persist + invalidate-on-edit. `result` через `getState()` (не deps)
    // запобігає re-mount-у subscription при кожній invalidation.
    useEffect(() => {
        const sub = form.watch((value) => {
            setFormData(value);
            if (useQrLandingDraftStore.getState().result) {
                invalidateResult();
            }
        });
        return () => sub.unsubscribe();
    }, [form, setFormData, invalidateResult]);

    return (
        <div className="grid gap-8 md:grid-cols-2 md:items-start">
            <QrLandingForm form={form} />
            <QrLandingResult form={form} />
        </div>
    );
}

function BlockSkeleton(props: { 'aria-label'?: string }) {
    return (
        <div
            aria-label={props['aria-label']}
            aria-busy
            className="grid gap-8 md:grid-cols-2 md:items-start"
        >
            <div className="bg-muted/30 h-[480px] animate-pulse rounded-xl" />
            <div className="bg-muted/30 h-[480px] animate-pulse rounded-xl" />
        </div>
    );
}

// Re-export для типізації prop-у в child-компонентах.
export type QrLandingFormInstance = UseFormReturn<QrPreviewInput>;
