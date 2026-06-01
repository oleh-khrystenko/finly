import { Mail, ShieldCheck } from 'lucide-react';

import { Logo } from '@/entities/brand';
import UiButton from '@/shared/ui/UiButton';

const PRODUCT_LINKS = [
    { href: '#how-it-works', label: 'Як це працює' },
    { href: '#why', label: 'Чому Finly' },
    { href: '#try-now', label: 'Спробувати без реєстрації' },
    { href: '/auth/signin', label: 'Увійти / Реєстрація' },
] as const;

const LEGAL_LINKS = [
    { href: '/privacy', label: 'Політика конфіденційності' },
    { href: '/terms', label: 'Умови використання' },
] as const;

/**
 * Footer лендінга. Three-column layout на desktop (Бренд / Продукт /
 * Юридичне+контакт), stack на mobile. Compliance-band — окрема секція
 * вище footer-strip-у з прямими цитатами з landing.md.
 */
export function LandingFooter() {
    const year = new Date().getFullYear();

    return (
        <footer className="bg-card border-border border-t">
            {/* Compliance band */}
            <div className="border-border border-b">
                <div className="container mx-auto px-6 py-10 md:py-12">
                    <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-[auto_1fr] md:gap-8">
                        <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-xl">
                            <ShieldCheck className="size-6" />
                        </div>
                        <div className="space-y-3 text-sm leading-relaxed">
                            <p className="text-muted-foreground">
                                Finly генерує платіжні QR-коди за стандартом НБУ
                                (постанова №97). Гроші проходять напряму між
                                банком клієнта і вашим IBAN-ом. Finly не
                                зберігає платежі, не утримує комісій з обороту і
                                не отримує доступу до ваших коштів.
                            </p>
                            <p className="text-muted-foreground">
                                <span className="text-foreground font-medium">
                                    Формат 003
                                </span>{' '}
                                (чинний з 01.11.2025) — основний.{' '}
                                <span className="text-foreground font-medium">
                                    Формат 002
                                </span>{' '}
                                — fallback для банків, які ще не оновились.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main footer columns */}
            <div className="container mx-auto px-6 py-12 md:py-16">
                <div className="grid gap-10 md:grid-cols-3 md:gap-12">
                    {/* Brand column */}
                    <div className="space-y-4">
                        <Logo />
                        <p className="text-foreground max-w-xs text-base leading-snug font-medium">
                            Веди справи, а не папери.
                        </p>
                    </div>

                    {/* Product column */}
                    <nav aria-labelledby="footer-product">
                        <h3
                            id="footer-product"
                            className="text-foreground text-sm font-semibold tracking-wide"
                        >
                            Продукт
                        </h3>
                        <ul className="mt-2 flex flex-col items-start gap-1">
                            {PRODUCT_LINKS.map(({ href, label }) => (
                                <li key={href}>
                                    <FooterLink href={href}>{label}</FooterLink>
                                </li>
                            ))}
                        </ul>
                    </nav>

                    {/* Legal + contact column */}
                    <nav aria-labelledby="footer-legal">
                        <h3
                            id="footer-legal"
                            className="text-foreground text-sm font-semibold tracking-wide"
                        >
                            Юридичне
                        </h3>
                        <ul className="mt-2 flex flex-col items-start gap-1">
                            {LEGAL_LINKS.map(({ href, label }) => (
                                <li key={href}>
                                    <FooterLink href={href}>{label}</FooterLink>
                                </li>
                            ))}
                            <li>
                                <UiButton
                                    as="a"
                                    href="mailto:support@finly.com.ua"
                                    variant="link"
                                    size="sm"
                                    IconLeft={<Mail />}
                                >
                                    support@finly.com.ua
                                </UiButton>
                            </li>
                        </ul>
                    </nav>
                </div>
            </div>

            {/* Copyright strip */}
            <div className="border-border border-t">
                <div className="container mx-auto flex flex-col items-center gap-1 px-6 pb-2 pt-4 sm:pt-2 text-center text-sm sm:flex-row sm:justify-between sm:gap-0 sm:text-left">
                    <p className="text-muted-foreground">
                        © {year} Finly. Всі права захищено.
                    </p>
                    <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-2 gap-y-1 sm:justify-end">
                        <span className="inline-flex items-center gap-1">
                            Ідея:
                            <UiButton
                                as="a"
                                href="https://easyfin.in.ua/"
                                target="_blank"
                                rel="noopener noreferrer"
                                variant="link"
                                size="sm"
                                className="text-primary hover:text-primary/80 font-medium"
                            >
                                EasyFin
                            </UiButton>
                        </span>
                        <span aria-hidden className="text-muted-foreground/50">
                            ·
                        </span>
                        <span className="inline-flex items-center gap-1">
                            Розробка:
                            <UiButton
                                as="a"
                                href="https://cyanship.com"
                                target="_blank"
                                rel="noopener noreferrer"
                                variant="link"
                                size="sm"
                                className="text-primary hover:text-primary/80 font-medium"
                            >
                                CyanShip
                            </UiButton>
                        </span>
                    </div>
                </div>
            </div>
        </footer>
    );
}

function FooterLink({
    href,
    children,
}: {
    href: string;
    children: React.ReactNode;
}) {
    if (href.startsWith('#')) {
        return (
            <UiButton as="a" href={href} variant="link" size="sm">
                {children}
            </UiButton>
        );
    }
    return (
        <UiButton as="link" href={href} variant="link" size="sm">
            {children}
        </UiButton>
    );
}
