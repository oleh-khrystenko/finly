'use client';

import { useClaimLandingDraft } from './useClaimLandingDraft';

/**
 * Sprint 8 §8.4 — мінімальний `'use client'`-компонент-обгортка для
 * `useClaimLandingDraft` хука. Сам нічого не рендерить — лише підписує
 * subscription на authStore + qrLandingDraftStore у protected-layout-у.
 *
 * **Чому окремий компонент**, а не `useClaimLandingDraft()` напряму у
 * `(protected)/layout.tsx`: layout — server component (default у Next App
 * Router). Виклик хука з server component — runtime error. Окремий client-
 * компонент створює React tree, у якому хук живе legitimately.
 *
 * **Чому СИБЛІНГ AuthGuard**, не дитина (sprint plan §8.4 critical):
 * AuthGuard повертає `null` для incomplete-profile-користувача на не-profile
 * routes (`AuthGuard.tsx:48-50`). Якщо хук всередині AuthGuard — для нової
 * реєстрації без імені (гілка B) хук не змонтується до завершення профілю.
 * AuthGuard зробить `router.replace('/profile?mode=new')` ще ДО mount-у
 * хука — користувач застряг на /profile, hook не активний.
 *
 * Як sibling — хук живий незалежно від того, що рендерить AuthGuard
 * (children, /profile, або null). Підписаний на authStore: коли profile
 * стає complete після PATCH `/users/me`, `useEffect` re-fires і викликає
 * `claimLandingDraftAsBusiness` з відповідним redirect-ом.
 */
export function ClaimLandingDraftHook(): null {
    useClaimLandingDraft();
    return null;
}
