import { ArrowDown, ArrowRight, ScanLine, X } from 'lucide-react';

/**
 * Контраст-блок "через тиждень" — split before/after. Ліва карта показує
 * біль (диктування IBAN), права — як це працює з Finly. Stack на mobile
 * з directional divider між ними.
 */
export function LandingContrast() {
    return (
        <section className="bg-card border-border border-y">
            <div className="container mx-auto px-6 py-16 md:py-24">
                <div className="mx-auto mb-12 max-w-2xl text-center md:mb-16">
                    <h2 className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
                        Через тиждень все інакше
                    </h2>
                    <p className="text-muted-foreground mt-4 text-base sm:text-lg">
                        Ви даєте клієнту одне посилання або QR. Він відкриває з
                        телефону і бачить ваше імʼя, призначення, кнопки банків.
                        Тапає свій банк. Тільки підтвердити.
                    </p>
                </div>

                <div className="relative grid gap-4 md:grid-cols-2 md:gap-6">
                    {/* BEFORE */}
                    <article className="border-destructive/25 bg-destructive/5 flex flex-col gap-4 rounded-2xl border p-6 md:p-8">
                        <div className="flex items-center gap-2">
                            <span className="bg-destructive/15 text-destructive inline-flex size-7 items-center justify-center rounded-full">
                                <X className="size-4" />
                            </span>
                            <span className="text-destructive text-xs font-medium tracking-widest uppercase">
                                Як зараз
                            </span>
                        </div>

                        <h3 className="text-foreground text-xl font-semibold">
                            Реквізити у месенджері
                        </h3>

                        <div className="bg-background border-border space-y-2 rounded-lg border p-4 font-mono text-xs sm:text-sm">
                            <p className="text-muted-foreground">
                                <span className="text-foreground">Ви:</span> ОК,
                                записуйте:
                            </p>
                            <p className="text-foreground tracking-wider break-all">
                                UA213223130000026007233566001
                            </p>
                            <p className="text-foreground">
                                ФОП Іваненко Олександр Миколайович
                            </p>
                            <p className="text-foreground">РНОКПП 3145678901</p>
                            <p className="text-muted-foreground italic">
                                Клієнт: «А куди це вставити?»
                            </p>
                        </div>

                        <ul className="text-muted-foreground mt-auto space-y-2 text-sm">
                            <Failure>
                                Помилка у цифрах: платіж до іншої людини
                            </Failure>
                            <Failure>
                                «Нагадайте реквізити ще раз завтра»
                            </Failure>
                            <Failure>Клієнт відклав і не повернувся</Failure>
                        </ul>
                    </article>

                    {/* Divider arrow — vertical on mobile, horizontal on desktop */}
                    <div
                        aria-hidden
                        className="bg-background border-border text-muted-foreground absolute top-1/2 left-1/2 z-10 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm"
                    >
                        <ArrowDown className="size-4 md:hidden" />
                        <ArrowRight className="hidden size-4 md:block" />
                    </div>

                    {/* AFTER */}
                    <article className="border-primary/30 bg-primary/5 flex flex-col gap-4 rounded-2xl border p-6 md:p-8">
                        <div className="flex items-center gap-2">
                            <span className="bg-primary/15 text-primary inline-flex size-7 items-center justify-center rounded-full">
                                <ScanLine className="size-4" />
                            </span>
                            <span className="text-primary text-xs font-medium tracking-widest uppercase">
                                З Finly
                            </span>
                        </div>

                        <h3 className="text-foreground text-xl font-semibold">
                            Одне посилання, один тап
                        </h3>

                        <div className="bg-background border-border space-y-3 rounded-lg border p-4 text-xs sm:text-sm">
                            <div className="text-muted-foreground flex items-center gap-2">
                                <span className="bg-primary inline-block size-2 rounded-full" />
                                <span className="font-mono">
                                    pay.finly.com.ua/ivanenko
                                </span>
                            </div>
                            <div className="bg-card border-border rounded-md border p-2.5">
                                <p className="text-foreground font-medium">
                                    ФОП Іваненко О. М.
                                </p>
                                <p className="text-muted-foreground mt-1 text-xs">
                                    Поповнення рахунку
                                </p>
                            </div>
                            <div className="bg-primary text-primary-foreground flex items-center justify-center rounded-md py-2 text-center text-xs font-medium">
                                Відкрити в monobank
                            </div>
                        </div>

                        <ul className="text-muted-foreground mt-auto space-y-2 text-sm">
                            <Success>
                                Без копіювання: система сама заповнює
                            </Success>
                            <Success>
                                Без помилок у цифрах: це неможливо
                            </Success>
                            <Success>
                                Без «нагадайте завтра»: посилання вічне
                            </Success>
                        </ul>
                    </article>
                </div>
            </div>
        </section>
    );
}

function Failure({ children }: { children: React.ReactNode }) {
    return (
        <li className="flex items-start gap-2">
            <X className="text-destructive mt-0.5 size-4 shrink-0" />
            <span>{children}</span>
        </li>
    );
}

function Success({ children }: { children: React.ReactNode }) {
    return (
        <li className="flex items-start gap-2">
            <svg
                className="text-primary mt-0.5 size-4 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
            >
                <path d="M20 6 9 17l-5-5" />
            </svg>
            <span>{children}</span>
        </li>
    );
}
