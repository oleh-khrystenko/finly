import {
    BrandSignature,
    ComplianceNote,
    Copyright,
    LegalNav,
} from '@/entities/brand';
import UiButton from '@/shared/ui/UiButton';

const PRODUCT_LINKS = [
    { href: '#how-it-works', label: 'Як це працює' },
    { href: '#why', label: 'Чому Finly' },
    { href: '#try-now', label: 'Спробувати без реєстрації' },
    { href: '/auth/signin', label: 'Увійти / Реєстрація' },
] as const;

/**
 * Footer лендінга. Three-column layout на desktop (Бренд / Продукт /
 * Юридичне+контакт), stack на mobile. Compliance-band — окрема секція
 * вище footer-strip-у.
 *
 * Бренд / compliance / legal / copyright — спільні блоки з `entities/brand`
 * (шаряться з public-футером `pay.finly.com.ua`). Тут лишається тільки
 * landing-специфічна Product-колонка.
 */
export function LandingFooter() {
    return (
        <footer className="bg-card border-border border-t">
            <ComplianceNote />

            {/* Main footer columns */}
            <div className="container mx-auto px-6 py-12 md:py-16">
                <div className="grid gap-10 md:grid-cols-3 md:gap-12">
                    <BrandSignature />

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

                    <LegalNav showContact />
                </div>
            </div>

            <Copyright />
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
