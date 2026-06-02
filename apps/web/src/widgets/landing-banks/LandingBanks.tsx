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

                {/*
                 * Grid з кратним 10 числом колонок → жодних осиротілих рядків:
                 *   375px → 2 колонки (5×2), назва в один рядок;
                 *   ≥640px → 5 колонок (2×5) — компактна trust-смуга.
                 * `max-w-3xl` центрує блок на 1280, щоб 5 колонок не розповзались.
                 */}
                <ul className="mx-auto grid max-w-3xl grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-5 px-6">
                    {MVP_BANKS.map((code) => (
                        <li
                            key={code}
                            className="group flex flex-col items-center gap-2"
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
