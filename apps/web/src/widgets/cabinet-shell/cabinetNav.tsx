import {
    Briefcase,
    FolderClosed,
    CreditCard,
    CircleHelp,
    BookOpen,
    Landmark,
} from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Єдине джерело навігації кабінету — і десктопний sidebar, і мобільний drawer
 * читають ці масиви через `useCabinetNav`. Раніше пункти жили жорстко зашиті у
 * `useUserMenu` всередині аватар-меню; тепер навігація відділена від
 * акаунт-дій (Профіль/Вийти лишились у `AccountSection`).
 */
export interface CabinetNavItem {
    key: string;
    label: string;
    icon: ReactNode;
    /** Відсутній для `comingSoon`-пунктів (нема куди вести). */
    href?: string;
    /** Disabled-тизер із бейджем «Незабаром» замість активного лінка. */
    comingSoon?: boolean;
    /** Показувати лише для `role === 'admin'`. */
    adminOnly?: boolean;
    badge?: string;
    /**
     * Додаткові префікси шляху, за яких пункт лишається активним. Потрібно, коли
     * один пункт веде на розділ із кількома табами-роутами (каталог: сторінка
     * «Отримувачі» на `href` + «Запити» на `/admin/publicity`).
     */
    matchPrefixes?: string[];
}

/** Робочі поверхні — верх sidebar. */
export const CABINET_PRIMARY_NAV: CabinetNavItem[] = [
    {
        key: 'businesses',
        label: 'Отримувачі',
        icon: <Briefcase />,
        href: '/business',
    },
    {
        // Тизер наперед: епік документів реально спланований (монетизація вже
        // існує), тож disabled-пункт із «Незабаром» задає напрям росту, а не
        // веде у порожнечу. Рівно один тизер — інакше sidebar виглядав би
        // недоробленим.
        key: 'documents',
        label: 'Документи',
        icon: <FolderClosed />,
        comingSoon: true,
        badge: 'Незабаром',
    },
];

/** Сервіс та акаунт-суміжне — низ sidebar. */
export const CABINET_SECONDARY_NAV: CabinetNavItem[] = [
    {
        key: 'billing',
        label: 'Тариф',
        icon: <CreditCard />,
        href: '/billing',
    },
    {
        key: 'help',
        label: 'Довідка',
        icon: <CircleHelp />,
        href: '/help',
    },
    {
        key: 'admin-guides',
        label: 'Гайди',
        icon: <BookOpen />,
        href: '/admin/guides',
        adminOnly: true,
    },
    {
        // Каталог і черга публічності — два таби одного розділу, тож один пункт.
        // `matchPrefixes` тримає його активним і на сторінці «Запити».
        key: 'admin-catalog',
        label: 'Каталог',
        icon: <Landmark />,
        href: '/admin/payees',
        matchPrefixes: ['/admin/publicity'],
        adminOnly: true,
    },
];
