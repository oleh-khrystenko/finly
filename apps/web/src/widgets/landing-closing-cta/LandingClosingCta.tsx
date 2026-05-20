import { ArrowRight } from 'lucide-react';

import UiButton from '@/shared/ui/UiButton';

/**
 * Фінальний CTA після всіх блоків. Direct-response: stating ринок-realit-y,
 * single primary action.
 */
export function LandingClosingCta() {
    return (
        <section className="bg-background">
            <div className="container mx-auto px-6 py-20 md:py-28">
                <div className="border-border bg-card relative mx-auto max-w-3xl overflow-hidden rounded-3xl border p-8 text-center md:p-14">
                    <div
                        aria-hidden
                        className="from-primary/20 via-primary/5 pointer-events-none absolute inset-0 -z-0 bg-gradient-to-br to-transparent"
                    />
                    <div className="relative z-10">
                        <h2 className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
                            Ринок уже пів року як перейшов на QR
                        </h2>
                        <p className="text-muted-foreground mx-auto mt-4 max-w-xl text-base sm:text-lg">
                            Ваш клієнт уже звик платити в один тап у когось
                            іншого.
                        </p>
                        <div className="mt-8 flex justify-center">
                            <UiButton
                                as="link"
                                href="/auth/signin"
                                variant="filled"
                                size="lg"
                                IconRight={<ArrowRight />}
                            >
                                Створити свою сторінку
                            </UiButton>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
