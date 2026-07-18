import { ReactNode } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { CabinetShell } from '@/widgets/cabinet-shell';
import { AuthGuard } from '@/features/auth';
import { ClaimLandingDraftHook } from '@/features/qr-landing-preview';
import { isPublicHost } from '@/shared/config/publicHosts';

interface ProtectedLayoutProps {
    children: ReactNode;
}

/**
 * Sprint 8 §8.4 — `<ClaimLandingDraftHook />` рендериться як null, але
 * утримує `useClaimLandingDraft` підписаним на authStore і
 * qrLandingDraftStore.
 *
 * **Sibling до AuthGuard, не дитина**: AuthGuard повертає `null` для
 * incomplete-profile-користувача на не-profile routes. Якщо hook всередині
 * AuthGuard — для нової реєстрації без імені (гілка B claim-flow) hook не
 * змонтується до завершення профілю. Як sibling — hook живий незалежно
 * від того, що рендерить AuthGuard (children, /profile, або null).
 *
 * **Server-component layout + client-sibling**: Next.js допускає змішані
 * children у server-layout — `ClaimLandingDraftHook` сам `'use client'`,
 * AuthGuard теж. Layout стає composite, але SSR-friendly (server-render
 * лише `<Header />` + delegate-render до children).
 */
// Protected pages вимагають runtime auth-check через `AuthGuard` (client-side
// authStore). Static prerender видавав би HTML без auth-state → flicker або
// build-time bailout для client-only hooks (`useSearchParams` у billing/cancel,
// billing/success, business/new, profile, account/new). `force-dynamic`
// узгоджує семантику з тим, що group і так не кешуватиметься.
export const dynamic = 'force-dynamic';

export default async function ProtectedLayout({
    children,
}: ProtectedLayoutProps) {
    // Defense-in-depth host-check (дзеркало host-pay SC): proxy.ts matcher
    // пропускає шляхи з крапкою (`.*\..*`-виключення для статики), тож
    // `pay-host/business/x.y` оминає Branch B і дістається cabinet-роуту.
    // Кабінетні route-и на public host non-addressable за контрактом — 404.
    const headerList = await headers();
    if (isPublicHost(headerList.get('host'))) {
        notFound();
    }
    return (
        <CabinetShell>
            <ClaimLandingDraftHook />
            <AuthGuard>{children}</AuthGuard>
        </CabinetShell>
    );
}
