import {
    BrandSignature,
    ComplianceNote,
    Copyright,
    LegalNav,
} from '@/entities/brand';
import UiButton from '@/shared/ui/UiButton';

/**
 * Footer help-center. Дзеркалить структуру landing-футера, але без
 * landing-специфічних якорів (#how-it-works тощо): тут Help-колонка з
 * посиланнями на довідку. Бренд / compliance / legal / copyright — спільні
 * блоки з `entities/brand`.
 */
const HELP_LINKS = [
    { href: '/help', label: 'Усі розділи' },
    { href: '/help/shcho-take-finly', label: 'Що таке Finly' },
    { href: '/help/yak-pratsiuie-qr', label: 'Як працює QR-код' },
    { href: '/auth/signin', label: 'Увійти / Реєстрація' },
] as const;

export function HelpFooter() {
    return (
        <footer className="bg-card border-border border-t">
            <ComplianceNote />

            <div className="container mx-auto px-6 py-12 md:py-16">
                <div className="grid gap-10 md:grid-cols-3 md:gap-12">
                    <BrandSignature />

                    <nav aria-labelledby="footer-help">
                        <h3
                            id="footer-help"
                            className="text-foreground text-sm font-semibold tracking-wide"
                        >
                            Довідка
                        </h3>
                        <ul className="mt-2 flex flex-col items-start gap-1">
                            {HELP_LINKS.map(({ href, label }) => (
                                <li key={href}>
                                    <UiButton
                                        as="link"
                                        href={href}
                                        variant="link"
                                        size="sm"
                                    >
                                        {label}
                                    </UiButton>
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
