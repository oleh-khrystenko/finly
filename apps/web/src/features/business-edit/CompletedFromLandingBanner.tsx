'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';

import UiButton from '@/shared/ui/UiButton';

const QUERY_PARAM = 'completed-from';
const EXPECTED_VALUE = 'landing';

/**
 * Sprint 8 §8.5 — banner-нагадування на business-detail-сторінці після
 * claim-flow з лендінгу (`?completed-from=landing`).
 *
 * **Мета**: claim-flow проставляє `acceptedBanks=[...MVP_BANKS]` (всі 11
 * банків за замовчуванням), бо landing-форма не має UI для bank-selection.
 * Після створення бізнесу запрошуємо ФОП переглянути список і прибрати
 * банки, якими він не користується.
 *
 * **Чому query-param trigger, а не localStorage flag**:
 *  - One-time UX: показ після claim → користувач або діє (Перейти до банків),
 *    або dismiss-ить → query-param знімається. На наступному відкритті
 *    /business/{slug} param відсутній → banner не з'являється.
 *  - Stateless: без localStorage-flag-у нема "кому показували / кому ні"
 *    state-management, який треба синхронізувати між browser-сесіями.
 *  - Source-of-truth — URL: shareable link з banner-ом працює (хоча й
 *    edge-case), і back-button навігації behave-ять prediктабельно.
 *
 * **`router.replace` без `completed-from` для dismiss**: видаляємо param
 * без створення history-entry (`replace`, не `push`) — back-button не
 * "назад до banner-варіанту URL". Pathname зберігаємо як є; preserve-имо
 * інші query-params (наприклад, якщо буде feature-flag з `?debug=...`).
 *
 * **`<a href="#banks">` для scroll-to-section**: native browser anchor
 * smooth-scroll-ить (за CSS `scroll-behavior: smooth` у root-layout або
 * default snapping). Жодного JS — anchor стандартний. Якщо `id="banks"`
 * на target-section відсутній (regression), anchor noop — banner не
 * crash-ається.
 */
export default function CompletedFromLandingBanner() {
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

    return (
        <div
            role="status"
            aria-live="polite"
            className="border-primary/40 bg-primary/5 rounded-xl border p-4 md:p-6"
        >
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                    <h2 className="text-foreground text-base font-semibold">
                        Дані з лендінгу збережено
                    </h2>
                    <p className="text-muted-foreground mt-2 text-sm">
                        За замовчуванням бізнес приймає всі 11 банків.
                        Перевірте список і зніміть галочки з тих, що не
                        використовуєте.
                    </p>
                    <div className="mt-4">
                        <UiButton as="a" href="#banks" variant="outline" size="sm">
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
