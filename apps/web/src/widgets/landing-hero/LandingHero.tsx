import { ArrowRight } from 'lucide-react';

import UiButton from '@/shared/ui/UiButton';

import { PhoneMockup } from './PhoneMockup';

/**
 * Hero для `finly.com.ua/`. Direct-response копія за `docs/marketing/landing.md`.
 *
 * Структура: 2-column на desktop (text + phone-mockup), stack на mobile.
 * Primary CTA — "Створити свою сторінку" → /auth/signin. Secondary —
 * "Спробувати без реєстрації" → якір на існуючий QrLandingBlock (#try-now).
 *
 * Server Component — статика + anchor links. Без client-runtime.
 */
export function LandingHero() {
    return (
        <section className="relative overflow-hidden">
            <div
                aria-hidden
                className="from-primary/15 via-background to-background pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br"
            />
            <div className="container mx-auto px-6 pt-16 pb-20 md:pt-24 md:pb-28">
                <div className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
                    <div className="max-w-xl">
                        <div className="border-border bg-card/60 text-muted-foreground mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs backdrop-blur">
                            <span className="bg-primary inline-block size-1.5 rounded-full" />
                            Стандарт НБУ, постанова №97
                        </div>

                        <h1 className="text-foreground text-4xl leading-[1.05] font-semibold tracking-tight sm:text-5xl lg:text-6xl">
                            Ваш клієнт хоче заплатити.
                            <br />
                            <span className="text-muted-foreground">
                                А ви диктуєте йому 29 цифр.
                            </span>
                        </h1>

                        <p className="text-muted-foreground mt-6 text-base leading-relaxed sm:text-lg">
                            Він копіює IBAN у вайбер, шукає у банк-додатку, де
                            його вставити, плутає Privat з Mono. Пише завтра:
                            «нагадайте реквізити ще раз». А когось ви взагалі
                            більше не побачите.
                        </p>

                        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                            <UiButton
                                as="link"
                                href="/auth/signin"
                                variant="filled"
                                size="lg"
                                IconRight={<ArrowRight />}
                            >
                                Створити свою сторінку
                            </UiButton>
                            <UiButton
                                as="a"
                                href="#try-now"
                                variant="outline"
                                size="lg"
                            >
                                Спробувати без реєстрації
                            </UiButton>
                        </div>
                    </div>

                    <div className="md:order-last">
                        <PhoneMockup />
                    </div>
                </div>
            </div>
        </section>
    );
}
