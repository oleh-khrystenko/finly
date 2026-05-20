import { BANK_LABEL, MVP_BANKS, type BankCode } from '@finly/types';

/**
 * Monogram-rail з 10 банків.
 *
 * TODO(post-launch): замінити monogram-плейсхолдери на реальні SVG-лого
 * банків. Це trust-блок, який візуально проседає поки лежать літери —
 * замінити перед широким launch-ом. Track: `docs/product/tech-backlog.md`
 * (додати рядок `landing-banks-svg-logos`).
 *
 * Підмінити можна точково у `getMonogram` без зміни layout: замість
 * `string` повернути `<svg>` або `<Image />`.
 */
export function LandingBanks() {
    return (
        <section className="bg-background">
            <div className="container mx-auto px-6 py-12 md:py-16">
                <p className="text-muted-foreground mb-8 text-center text-xs font-medium tracking-widest uppercase">
                    Працює з банк-додатками
                </p>

                <ul className="mx-auto flex max-w-5xl flex-wrap items-start justify-center gap-x-4 gap-y-6 sm:gap-x-8">
                    {MVP_BANKS.map((code) => (
                        <li
                            key={code}
                            className="group flex w-16 flex-col items-center gap-2 sm:w-20"
                        >
                            <div className="border-border bg-card text-muted-foreground group-hover:border-primary/40 group-hover:text-primary group-hover:bg-primary/5 flex size-12 items-center justify-center rounded-full border text-sm font-semibold transition-colors sm:size-14 sm:text-base">
                                {getMonogram(code)}
                            </div>
                            <span className="text-muted-foreground text-center text-xs leading-tight">
                                {BANK_LABEL[code]}
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
}

function getMonogram(code: BankCode): string {
    const overrides: Partial<Record<BankCode, string>> = {
        privatbank: 'П',
        monobank: 'm',
        pumb: 'ПУ',
        oschadbank: 'О',
        sense: 'S',
        ukrgazbank: 'У',
        izibank: 'iZ',
        raiffeisen: 'R',
        abank: 'A',
        credit_dnipro: 'КД',
    };
    return overrides[code] ?? code.charAt(0).toUpperCase();
}
