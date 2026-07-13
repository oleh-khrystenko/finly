import type { HelpAuthor } from './types';

/**
 * Help article authors. Compile-time constant, same as categories/articles.
 * Tetiana also appears on the landing partner block; the byline, the author
 * card and the /avtor/[id] profile page reuse this single identity so the
 * trust signal stays consistent across the site.
 *
 * Facts are grounded in the author's own CV / LinkedIn (docs, provided by the
 * user): do not embellish credentials beyond what is verifiable.
 */
export const HELP_AUTHORS: readonly HelpAuthor[] = [
    {
        id: 'tetiana-priadko',
        name: 'Тетяна Прядко',
        role: 'Головний бухгалтер, співавторка Finly',
        bio: 'Головний бухгалтер і фінансовий директор із 20-річним досвідом, засновниця бухгалтерського сервісу EasyFin і співавторка ідеї Finly.',
        longBio:
            'Головний бухгалтер і фінансовий директор із 20-річним досвідом. Заснувала і керує бухгалтерським сервісом EasyFin. До цього вела фінансовий облік меблевого виробництва і агробізнесу, супроводжувала десятки ФОП. Спеціалізується на оподаткуванні підприємців і податкових перевірках. Співавторка ідеї Finly.',
        location: 'Полтава, Україна',
        photo: '/partners/tetiana-priadko.webp',
        worksFor: { name: 'EasyFin', url: 'https://easyfin.in.ua/' },
        alumniOf: 'Полтавський університет споживчої кооперації',
        knowsAbout: [
            'Бухгалтерський облік',
            'Оподаткування ФОП',
            'Податкові перевірки',
            'Фінансовий облік',
        ],
        sameAs: [
            'https://www.linkedin.com/in/%D1%82%D0%B5%D1%82%D1%8F%D0%BD%D0%B0-%D0%BF%D1%80%D1%8F%D0%B4%D0%BA%D0%BE-529574208/',
            'https://easyfin.in.ua/',
            'https://t.me/EasyFinChannel',
        ],
    },
] as const;
