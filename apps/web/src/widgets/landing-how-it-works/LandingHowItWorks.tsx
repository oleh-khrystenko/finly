import { CreditCard, FileText, UserPlus } from 'lucide-react';

const STEPS = [
    {
        num: '01',
        Icon: UserPlus,
        title: 'Реєстрація за хвилину',
        body: 'Google або magic-link на пошту. Без анкет, без сканів паспорта.',
    },
    {
        num: '02',
        Icon: CreditCard,
        title: 'Один раз вводите IBAN',
        body: 'Він стає вашою постійною платіжною сторінкою — посилання і QR.',
    },
    {
        num: '03',
        Icon: FileText,
        title: 'Даєте клієнтам',
        body: 'Друкуєте на касі, ставите у візитку, кладете в Instagram bio.',
    },
] as const;

/**
 * "Як це працює" — 3-step rail. Horizontal на desktop з пунктирною лінією
 * між кроками; vertical numbered list на mobile. Останній абзац про окремі
 * інвойси — окрема note-карта внизу.
 */
export function LandingHowItWorks() {
    return (
        <section
            id="how-it-works"
            aria-labelledby="how-it-works-heading"
            className="bg-background"
        >
            <div className="container mx-auto px-6 py-16 md:py-24">
                <div className="mx-auto mb-12 max-w-2xl text-center md:mb-16">
                    <h2
                        id="how-it-works-heading"
                        className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl"
                    >
                        Як це працює
                    </h2>
                </div>

                <ol className="relative mx-auto grid max-w-5xl gap-8 md:grid-cols-3 md:gap-6">
                    {/* Pointed connector for desktop */}
                    <div
                        aria-hidden
                        className="border-border absolute top-7 right-[16.67%] left-[16.67%] hidden border-t border-dashed md:block"
                    />

                    {STEPS.map(({ num, Icon, title, body }) => (
                        <li
                            key={num}
                            className="bg-card border-border relative flex flex-col items-start gap-4 rounded-2xl border p-6 md:items-center md:p-8 md:text-center"
                        >
                            <div className="bg-primary text-primary-foreground relative z-10 flex size-14 items-center justify-center rounded-full text-lg font-semibold shadow-md">
                                <Icon className="size-6" />
                            </div>
                            <span className="text-muted-foreground absolute top-6 right-6 font-mono text-xs tracking-widest md:static md:mt-2">
                                {num}
                            </span>
                            <h3 className="text-foreground text-lg font-semibold">
                                {title}
                            </h3>
                            <p className="text-muted-foreground text-sm leading-relaxed">
                                {body}
                            </p>
                        </li>
                    ))}
                </ol>

                <div className="border-border bg-card mx-auto mt-10 max-w-3xl rounded-xl border p-5 text-center md:mt-12 md:p-6">
                    <p className="text-muted-foreground text-sm">
                        <span className="text-foreground font-medium">
                            Для одноразових платежів
                        </span>{' '}
                        — окремий інвойс із фіксованою сумою, призначенням і
                        терміном дії. Стільки, скільки треба.
                    </p>
                </div>
            </div>
        </section>
    );
}
