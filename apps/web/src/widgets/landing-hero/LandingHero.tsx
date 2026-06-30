import { ArrowRight } from 'lucide-react';

import UiButton from '@/shared/ui/UiButton';

import { HeroDevice } from './HeroDevice';

/**
 * Hero для `finly.com.ua/`. Direct-response копія за `docs/marketing/landing.md`.
 *
 * Композиція: текст — одна ліва колонка в контейнері; hero-візуал
 * (`HeroDevice`) на desktop винесений `absolute` до правого краю секції,
 * збільшений і з легким bleed за в'юпорт (overflow-hidden клипає). На mobile
 * візуал повертається у звичайний потік під текстом. Це преміум-патерн hero-
 * шоту — продукт домінує праворуч, копія дихає ліворуч.
 *
 * Primary CTA — "Створити свою сторінку" → /auth/signin. Secondary —
 * "Спробувати без реєстрації" → якір на існуючий QrLandingBlock (#try-now).
 *
 * Server Component — статика + anchor links. Без client-runtime.
 */
export function LandingHero() {
    return (
        <section className="relative overflow-hidden lg:min-h-160">
            <HeroDevice />

            <div className="relative z-10 container mx-auto px-6 pt-6 pb-12 lg:pt-24 lg:max-w-136 lg:pb-24 xl:max-w-160">
                <div className="border-border bg-card/60 text-muted-foreground mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs backdrop-blur">
                    <span className="bg-primary inline-block size-1.5 rounded-full" />
                    Стандарт НБУ, постанова №97
                </div>

                <h1 className="text-foreground text-4xl leading-[1.05] font-semibold tracking-tight sm:text-5xl xl:text-6xl">
                    Ваш клієнт хоче заплатити.
                    <br />
                    <span className="text-muted-foreground">
                        А ви диктуєте йому 29 цифр.
                    </span>
                </h1>

                <p className="text-muted-foreground mt-6 max-w-xl text-base leading-relaxed sm:text-lg">
                    Він копіює IBAN у вайбер, шукає у банк-додатку, де його
                    вставити, плутає Privat з Mono. Пише завтра: «нагадайте
                    реквізити ще раз». А когось ви взагалі більше не побачите.
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
        </section>
    );
}
