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
        tagline: 'Платіжні сторінки та QR-коди під вашим брендом',
        badge: 'Рекомендуємо',
        features: [
            'Клієнт бачить ваше імʼя в адресі й розуміє, що платить саме вам: pay.finly.com.ua/your-brand',
            // TODO: розкоментувати, коли зʼявиться функціонал брендованого QR (логотип + оформлена сторінка оплати)
            // 'QR з вашим логотипом, що приводить клієнта на оформлену під вас сторінку оплати',
            // 'Брендований QR за стандартом НБУ: клієнт наводить камеру, і платіж уже готовий, без жодної цифри вручну',
        ],
    },
    bookkeeper: {
        tagline: 'Усе з «Бренду» та безліміт на клієнтів і власні компанії',
        features: [
            'Усе з тарифу «Бренд»',
            'Режим бухгалтера: необмежено клієнтських отримувачів, реквізитів і рахунків',
            'Власні компанії без обмежень: ТОВ та організації',
        ],
    },
};

interface OneOffCopy {
    tagline: string;
    badge?: string;
}

export const ONE_OFF_COPY: Record<string, OneOffCopy> = {
    brand: {
        tagline: 'Разовий доступ рівня «Бренд» на місяць',
        badge: 'Оптимально',
    },
    bookkeeper: {
        tagline: 'Разовий доступ рівня «Агенція» на місяць',
    },
};

export const ACCESS_LEVEL_LABEL: Record<AccessLevel, string> = {
    none: 'Безкоштовний',
    brand: 'Бренд',
    bookkeeper: 'Агенція',
};
