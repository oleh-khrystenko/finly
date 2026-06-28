'use client';

import { useSyncExternalStore } from 'react';
import {
    BANK_APP_LAUNCH,
    BANK_LABEL,
    MVP_BANKS,
    buildBankAppLink,
    type BankCode,
} from '@finly/types';
import {
    composeClasses,
    detectClientPlatform,
    type ClientPlatform,
} from '@/shared/lib';
import UiBankLogo from '@/shared/ui/UiBankLogo';

export interface UiBankAppGridProps {
    /**
     * НБУ legacy payload-link (`https://bank.gov.ua/qr/<payload>`). Підміною
     * протоколу з нього будується per-bank deep-link (`buildBankAppLink`).
     */
    nbuLegacyLink: string;
    /**
     * Загальний НБУ universal-link (зазвичай `nbuLinks.primary`). Fallback,
     * коли відкрити саме обраний банк неможливо: iOS без відомої приватної
     * схеми, або desktop (банк-додатків немає — веде на НБУ-сторінку).
     */
    nbuFallbackLink: string;
    /** Перелік банків. За замовчуванням — `MVP_BANKS`. */
    banks?: readonly BankCode[];
    className?: string;
}

// Платформа не змінюється протягом сесії → порожня підписка. getServerSnapshot
// віддає 'desktop' (повний список) для SSR і першого client-render.
const subscribePlatform = () => () => {};
const getServerPlatform = (): ClientPlatform => 'desktop';

/**
 * Сітка банків, що відкриває конкретний банк-додаток із заповненими
 * реквізитами (Sprint 5 §3.1, `docs/sprints/05-per-bank/`).
 *
 * Платформу читаємо через `useSyncExternalStore`, не під час SSR: перший
 * рендер віддає повний список (як на desktop), далі на iOS список звужується до
 * банків з підтвердженою приватною схемою. Серверна й перша клієнтська розмітка
 * лишаються ідентичними (без hydration-mismatch), а з iOS зникають кнопки, що
 * відкрили б не той банк. `buildBankAppLink` дає iOS-схему / Android-intent або
 * `null` (→ fallback на загальний НБУ-link).
 *
 * Живе у `shared/ui`, бо споживається кількома public-payment фічами
 * (`account-public`, `invoice-public`) — feature→feature import заборонений
 * (FSD), а тут єдина точка контакту з нативним `<button>`.
 *
 * Per-bank schemes приватні й крихкі (банк може змінити схему) — UI поряд
 * завжди лишає загальний НБУ-link + QR як запасний шлях.
 */
export default function UiBankAppGrid({
    nbuLegacyLink,
    nbuFallbackLink,
    banks = MVP_BANKS,
    className,
}: UiBankAppGridProps) {
    // SSR і перший client-render віддають 'desktop' (повний список) → розмітка
    // ідентична на сервері й клієнті. useSyncExternalStore гарантує відсутність
    // hydration-mismatch, далі рендер уточнюється до реальної платформи.
    const platform = useSyncExternalStore(
        subscribePlatform,
        detectClientPlatform,
        getServerPlatform
    );

    // На iOS націлити конкретний банк можна лише тим, хто реєструє приватну
    // схему (privat/mono/abank). У решти тап відкрив би «не той» банк (вибір
    // системи), тож на iOS їх ховаємо — оплата для них іде загальним НБУ-link
    // («Мого банку немає у списку» в UiPaymentOptions). Android відкриває
    // будь-який банк через intent://package=; desktop банк-додатків не має.
    const visibleBanks =
        platform === 'ios'
            ? banks.filter((bank) => BANK_APP_LAUNCH[bank].iosScheme !== null)
            : banks;

    const handleSelect = (bank: BankCode) => {
        const target =
            platform === 'desktop'
                ? nbuFallbackLink
                : (buildBankAppLink(nbuLegacyLink, bank, platform) ??
                  nbuFallbackLink);

        window.location.assign(target);
    };

    return (
        <div
            className={composeClasses(
                'grid grid-cols-2 gap-3 md:grid-cols-3',
                className
            )}
        >
            {visibleBanks.map((bank) => {
                const label = BANK_LABEL[bank];
                return (
                    <button
                        key={bank}
                        type="button"
                        onClick={() => handleSelect(bank)}
                        aria-label={`Оплатити через ${label}`}
                        className="border-border bg-card text-foreground hover:border-foreground/30 hover:bg-muted/50 focus-visible:ring-ring flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2"
                    >
                        <UiBankLogo bank={bank} className="size-10" />
                        <span className="min-w-0 truncate text-sm leading-tight font-medium">
                            {label}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
