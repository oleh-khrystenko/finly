import { BANK_LABEL, MVP_BANKS } from '@finly/types';
import UiBankLogo from '@/shared/ui/UiBankLogo';

/**
 * Trust-rail з 10 банків. Логотипи — через `UiBankLogo` (єдине джерело істини,
 * `public/banks/*.webp`); власних плейсхолдерів блок не тримає.
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
                            <UiBankLogo
                                bank={code}
                                className="size-12 transition-transform group-hover:scale-105 sm:size-14"
                            />
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
