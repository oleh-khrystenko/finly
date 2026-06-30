import { Mail } from 'lucide-react';

import { Copyright } from '@/entities/brand';
import UiButton from '@/shared/ui/UiButton';

const NAV_LINKS = [
    { href: '/help', label: 'Довідка' },
    { href: '/privacy', label: 'Конфіденційність' },
    { href: '/terms', label: 'Умови використання' },
] as const;

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
export function AppFooter() {
    return (
        <footer className="bg-card border-border border-t">
            <nav
                aria-label="Підвал"
                className="container mx-auto flex flex-col items-center gap-3 px-6 py-4 sm:flex-row sm:justify-between sm:gap-6"
            >
                <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 sm:justify-start">
                    {NAV_LINKS.map(({ href, label }) => (
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
