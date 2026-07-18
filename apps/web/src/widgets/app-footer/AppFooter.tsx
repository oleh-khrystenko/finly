import { Mail } from 'lucide-react';

import { Copyright } from '@/entities/brand';
import UiButton from '@/shared/ui/UiButton';

const HELP_LINK = { href: '/help', label: 'Довідка' } as const;
const LEGAL_LINKS = [
    { href: '/privacy', label: 'Конфіденційність' },
    { href: '/terms', label: 'Умови використання' },
] as const;

interface AppFooterProps {
    /**
     * Показувати пункт «Довідка». У кабінеті `false` — Довідка тепер
     * першокласний пункт навігації у бічному меню, дублювати у футері зайве.
     * На auth/legal-поверхнях (де sidebar немає) лишається `true`.
     */
    showHelpLink?: boolean;
}

/**
 * Мінімальний футер для non-marketing-поверхонь — auth, legal (`/privacy`,
 * `/terms`) і весь кабінет. На відміну від landing/help/public-футерів не несе
 * compliance-плашки чи growth-CTA.
 *
 * Структура дзеркалить `Copyright`-смугу (flex-col + center на mobile →
 * flex-row + justify-between на desktop): навігація ліворуч над ©, контакт
 * праворуч над кредитами — єдиний візуальний ритм через обидва рядки. Усі
 * лінки internal (cabinet-host `finly.com.ua`), тож `baseUrl` не потрібен.
 */
export function AppFooter({ showHelpLink = true }: AppFooterProps) {
    const navLinks = showHelpLink
        ? [HELP_LINK, ...LEGAL_LINKS]
        : [...LEGAL_LINKS];

    return (
        <footer className="bg-card border-border border-t">
            <nav
                aria-label="Підвал"
                className="container mx-auto flex flex-col items-center gap-3 px-6 py-4 sm:flex-row sm:justify-between sm:gap-6"
            >
                <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 sm:justify-start">
                    {navLinks.map(({ href, label }) => (
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

                <div className="flex flex-col items-center gap-1 sm:items-end">
                    <p className="text-muted-foreground text-sm sm:text-right">
                        Щось працює не так? Розкажіть нам, і ми це виправимо.
                    </p>
                    <UiButton
                        as="a"
                        href="mailto:support@finly.com.ua"
                        variant="link"
                        size="sm"
                        IconLeft={<Mail />}
                    >
                        support@finly.com.ua
                    </UiButton>
                </div>
            </nav>

            <Copyright />
        </footer>
    );
}
