import Image from 'next/image';
import { ArrowUpRight, Quote } from 'lucide-react';

import UiButton from '@/shared/ui/UiButton';

const EASYFIN_URL = 'https://easyfin.in.ua/';

/**
 * Блок-партнер EasyFin. Стоїть між "Банки" і фінальним CTA.
 *
 * Працює одночасно на три цілі: довіра до Finly (продукт зроблено разом із
 * бухгалтером-практиком, що знає норматив НБУ), ліди для EasyFin і кредит
 * співавторці ідеї. CTA навмисно вторинний (outline), щоб не конкурувати з
 * головним filled-CTA сторінки.
 *
 * Ассети (надає користувач, локальні static-файли):
 *   public/partners/tetiana-priadko.webp  — фото (портрет)
 *   public/partners/easyfin-light.webp    — лого для світлої теми
 *   public/partners/easyfin-dark.webp     — лого для темної теми
 *
 * Зараз обидва лого однакові (одноколірне, читається на обох темах). Слоти
 * розведені навмисно: коли з'явиться окремий dark-варіант — достатньо замінити
 * файл, код не змінюється.
 *
 * Server Component — статика + зовнішнє посилання, без client-runtime.
 */
export function LandingPartner() {
    return (
        <section aria-labelledby="partner-heading" className="bg-background">
            <div className="container mx-auto px-6 py-16 md:py-20">
                <div className="border-border bg-card mx-auto max-w-4xl rounded-3xl border p-6 sm:p-8 md:p-10">
                    <div className="flex flex-col items-center gap-6 text-center md:flex-row md:items-start md:gap-10 md:text-left">
                        <div className="relative aspect-[4/5] w-36 shrink-0 overflow-hidden rounded-2xl sm:w-40 md:aspect-auto md:w-48 md:self-stretch lg:w-56">
                            <Image
                                src="/partners/tetiana-priadko.webp"
                                alt="Тетяна Прядко, засновниця EasyFin"
                                fill
                                sizes="(max-width: 768px) 160px, 224px"
                                className="object-cover object-top"
                            />
                        </div>

                        <div className="flex flex-col items-center md:items-start">
                            <h2
                                id="partner-heading"
                                className="text-muted-foreground text-sm font-medium tracking-widest uppercase"
                            >
                                Створено разом з бухгалтером-практиком
                            </h2>

                            <blockquote className="text-foreground mt-4 text-lg leading-relaxed sm:text-xl">
                                <Quote
                                    aria-hidden
                                    className="text-primary/40 mb-2 size-6"
                                />
                                Я щодня бачу, як підприємці втрачають клієнтів
                                на банальному «продиктуйте реквізити ще раз».
                                Finly прибирає цей крок: одне посилання,
                                заповнена форма в банку, гроші напряму на IBAN
                                за стандартом НБУ. Саме тому я стою за цим
                                продуктом.
                            </blockquote>

                            <div className="mt-6 flex flex-col items-center gap-3 md:flex-row md:items-center md:gap-4">
                                <cite className="not-italic">
                                    <span className="text-foreground block text-base font-semibold">
                                        Тетяна Прядко
                                    </span>
                                    <span className="text-muted-foreground block text-sm leading-snug">
                                        Бухгалтер-аудитор, засновниця EasyFin.
                                        Співавторка ідеї Finly.
                                    </span>
                                </cite>

                                <span
                                    aria-hidden
                                    className="bg-border hidden h-8 w-px md:block"
                                />

                                <span className="relative h-8 w-32 shrink-0">
                                    <Image
                                        src="/partners/easyfin-light.webp"
                                        alt="EasyFin"
                                        fill
                                        sizes="128px"
                                        className="object-contain object-center md:object-left dark:hidden"
                                    />
                                    <Image
                                        src="/partners/easyfin-dark.webp"
                                        alt="EasyFin"
                                        fill
                                        sizes="128px"
                                        className="hidden object-contain object-center md:object-left dark:block"
                                    />
                                </span>
                            </div>

                            <div className="mt-7">
                                <UiButton
                                    as="a"
                                    href={EASYFIN_URL}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    variant="outline"
                                    size="md"
                                    IconRight={<ArrowUpRight />}
                                >
                                    Потрібен повний супровід? EasyFin
                                </UiButton>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
