import type { AccessLevel } from '@finly/types';

/**
 * Sprint 19 — копія каталогу по цінності (айдентика + масштаб), без «виконань».
 * Single source для сторінки білінгу і діалогу зміни плану. Назви/ціни/рівень
 * беруться з `@finly/types` каталогу; тут — лише маркетингова копія (tagline,
 * badge, перелік можливостей) keyed by code.
 */

interface PlanCopy {
    tagline: string;
    badge?: string;
    features: string[];
}

export const PLAN_COPY: Record<string, PlanCopy> = {
    brand: {
        tagline: 'Власні посилання для отримувача, реквізитів і рахунків',
        features: [
            'Власні посилання (slug) для отримувача, реквізитів і рахунків',
            'Платіжні QR-коди за стандартом НБУ',
            'Публічні сторінки оплати та платіжні посилання',
        ],
    },
    bookkeeper: {
        tagline: 'Для бухгалтерів: багато клієнтів і компаній',
        badge: 'Популярний',
        features: [
            'Усе з тарифу «Свій бренд»',
            'Режим бухгалтера: необмежено клієнтських отримувачів',
            'Необмежено власних компаній (ТОВ, організації)',
        ],
    },
};

interface OneOffCopy {
    tagline: string;
    badge?: string;
}

export const ONE_OFF_COPY: Record<string, OneOffCopy> = {
    brand: {
        tagline: 'Разовий доступ рівня «Свій бренд» на 30 днів',
    },
    bookkeeper: {
        tagline: 'Разовий доступ рівня «Бухгалтер» на 30 днів',
        badge: 'Повний доступ',
    },
};

export const ACCESS_LEVEL_LABEL: Record<AccessLevel, string> = {
    none: 'Безкоштовний',
    brand: 'Свій бренд',
    bookkeeper: 'Бухгалтер',
};
