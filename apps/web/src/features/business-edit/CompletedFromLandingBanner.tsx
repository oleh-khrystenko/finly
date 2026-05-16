'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';

import UiButton from '@/shared/ui/UiButton';

const QUERY_PARAM = 'completed-from';
const EXPECTED_VALUE = 'landing';

interface Props {
    /**
     * Sprint 10 §10.2 — banner переїхав з `/business/[slug]` на
     * `/business/[slug]/account/[accountSlug]`, бо claim-flow тепер success-
     * redirect-ить на per-account page. "Перейти до банків" CTA робить
     * cross-page navigation на `/business/{slug}#banks` — звідси потрібен
     * `businessSlug` для побудови link-у.
     */
    businessSlug: string;
}

/**
 * Sprint 8 §8.5 / Sprint 10 §10.2 — banner-нагадування на per-account-page
 * після claim-flow з лендінгу (`?completed-from=landing`).
 *
 * **Мета**: claim-flow проставляє `acceptedBanks=[...MVP_BANKS]` (всі 11
 * банків за замовчуванням), бо landing-форма не має UI для bank-selection.
 * Після створення Business + Account запрошуємо ФОП переглянути список і
 * прибрати банки, якими він не користується.
 *
 * **Query-param trigger, не localStorage flag**:
 *  - One-time UX: показ після claim → користувач діє або dismiss-ить →
 *    query-param знімається; на наступному відкритті banner не з'являється.
 *  - Stateless: без localStorage-flag-у нема cross-session-state-management.
 *  - Source-of-truth — URL: back-button поведінка predictable.
 *
 * **Cross-page CTA**: clicking "Перейти до банків" робить `router.push` на
 * `/business/{slug}#banks`. Native anchor у `<a href>` дав би smooth-scroll
 * у тій самій сторінці, але banks-section живе на business-page-і, не
 * per-account-page-і. Next-Link не підтримує hash-anchor одночасно з
 * scroll-restoration. `router.push` з фрагментом — найпростіший варіант.
 */
export default function CompletedFromLandingBanner({ businessSlug }: Props) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    if (searchParams.get(QUERY_PARAM) !== EXPECTED_VALUE) {
        return null;
    }

    const handleDismiss = (): void => {
        const next = new URLSearchParams(searchParams.toString());
        next.delete(QUERY_PARAM);
        const query = next.toString();
        router.replace(query ? `${pathname}?${query}` : pathname);
    };

    const handleNavigateToBanks = (): void => {
        router.push(`/business/${businessSlug}#banks`);
    };

    return (
        <div
            role="status"
            aria-live="polite"
            className="border-primary/40 bg-primary/5 rounded-xl border p-4 md:p-6"
        >
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                    <h2 className="text-foreground text-base font-semibold">
                        Бізнес і рахунок збережено з лендінгу
                    </h2>
                    <p className="text-muted-foreground mt-2 text-sm">
                        За замовчуванням бізнес приймає всі 11 банків.
                        Перевірте список і зніміть галочки з тих, що не
                        використовуєте.
                    </p>
                    <div className="mt-4">
                        <UiButton
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleNavigateToBanks}
                        >
                            Перейти до банків
                        </UiButton>
                    </div>
                </div>
                {/*
                 * `variant="icon"` (не `"icon-compact"`) — banner рендериться
                 * на mobile business-detail сторінці (`/business/[slug]`).
                 * `responsive.md §2` вимагає touch-target ≥ 44×44 px;
                 * `icon-compact` навмисно desktop-only виняток без 44×44
                 * baseline. `icon` — primitive-level enforcement через
                 * `min-h-11 min-w-11`, без потреби у custom className.
                 */}
                <UiButton
                    type="button"
                    variant="icon"
                    onClick={handleDismiss}
                    aria-label="Сховати повідомлення"
                    IconLeft={<X />}
                />
            </div>
        </div>
    );
}
