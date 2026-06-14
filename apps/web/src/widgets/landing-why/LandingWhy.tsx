import { Building2, Shield, Sparkles, Wallet } from 'lucide-react';

const FEATURES = [
    {
        Icon: Shield,
        title: 'Стандарт НБУ',
        body: 'Постанова №97, формат 003, чинний з 1 листопада 2025 року. Не наш формат. Той самий, що читає будь-який банк-додаток в Україні.',
    },
    {
        Icon: Wallet,
        title: 'Гроші напряму на ваш IBAN',
        body: 'Finly не торкається платежу. Жодних відсотків з обороту, жодних посередників між клієнтом і вами.',
    },
    {
        Icon: Building2,
        title: '10 банків у списку',
        body: 'Privat, monobank, ПУМБ, Ощад, Sense, Укргазбанк, IZIBank, Райф, A-Bank, Кредит Дніпро. Паралельно підтримуємо старий формат 002.',
    },
    {
        Icon: Sparkles,
        title: 'Безкоштовно для одного отримувача',
        body: 'Один IBAN, безліч одноразових рахунків. Платні тарифи: кілька отримувачів і власне лого на QR.',
    },
] as const;

/**
 * "Чому це не ще один сервіс" — 2×2 grid фіч з icon-badge. Кожна фіча
 * прив'язана до конкретного product-constraint, не до маркетинг-claim-у.
 */
export function LandingWhy() {
    return (
        <section
            id="why"
            aria-labelledby="why-heading"
            className="bg-card border-border border-y"
        >
            <div className="container mx-auto px-6 py-16 md:py-24">
                <div className="mx-auto mb-12 max-w-2xl text-center md:mb-16">
                    <h2
                        id="why-heading"
                        className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl"
                    >
                        Чому це не «ще один сервіс»
                    </h2>
                </div>

                <ul className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2 md:gap-6">
                    {FEATURES.map(({ Icon, title, body }) => (
                        <li
                            key={title}
                            className="bg-background border-border flex gap-4 rounded-2xl border p-6 md:p-7"
                        >
                            <div className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
                                <Icon className="size-5" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <h3 className="text-foreground text-base font-semibold">
                                    {title}
                                </h3>
                                <p className="text-muted-foreground text-sm leading-relaxed">
                                    {body}
                                </p>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
}
