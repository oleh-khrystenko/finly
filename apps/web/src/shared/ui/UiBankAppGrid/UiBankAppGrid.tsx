'use client';

import {
    BANK_LABEL,
    MVP_BANKS,
    buildBankAppLink,
    type BankCode,
} from '@finly/types';
import { composeClasses, detectClientPlatform } from '@/shared/lib';
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

/**
 * Сітка банків, що відкриває конкретний банк-додаток із заповненими
 * реквізитами (Sprint 5 §3.1, `docs/sprints/05-per-bank/`).
 *
 * Платформа визначається на кліку (`detectClientPlatform`), а не на рендері —
 * це уникає SSR-mismatch: розмітка ідентична на сервері й клієнті, лише
 * обробник читає `navigator`. `buildBankAppLink` дає iOS-схему / Android-intent
 * або `null` (→ fallback на загальний НБУ-link).
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
    const handleSelect = (bank: BankCode) => {
        const platform = detectClientPlatform();
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
                'grid grid-cols-2 gap-3 sm:grid-cols-3',
                className
            )}
        >
            {banks.map((bank) => {
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
