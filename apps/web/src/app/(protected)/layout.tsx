import { ReactNode } from 'react';
import { Header } from '@/widgets/header';
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
export default function ProtectedLayout({ children }: ProtectedLayoutProps) {
    return (
        <>
            <Header />
            <ClaimLandingDraftHook />
            <AuthGuard>{children}</AuthGuard>
        </>
    );
}
