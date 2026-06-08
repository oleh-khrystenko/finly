import { ReactNode } from 'react';
import { Header } from '@/widgets/header';
import { AppFooter } from '@/widgets/app-footer';
import { AuthGuard } from '@/features/auth';
import { ClaimLandingDraftHook } from '@/features/qr-landing-preview';

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

export default function ProtectedLayout({ children }: ProtectedLayoutProps) {
    return (
        <>
            <Header />
            <ClaimLandingDraftHook />
            <div className="flex flex-1 flex-col">
                <AuthGuard>{children}</AuthGuard>
            </div>
            <AppFooter />
        </>
    );
}
