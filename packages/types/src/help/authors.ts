import type { HelpAuthor } from './types';

/**
 * Help article authors. Compile-time constant, same as categories/articles.
 * Tetiana already appears on the landing partner block; the byline reuses the
 * same identity so the trust signal is consistent across the site.
 */
export const HELP_AUTHORS: readonly HelpAuthor[] = [
    {
        id: 'tetiana-priadko',
        name: 'Тетяна Прядко',
        role: 'Бухгалтер-аудитор, засновниця EasyFin',
        bio: 'Бухгалтер-аудитор із багаторічною практикою, засновниця EasyFin і співавторка ідеї Finly. Веде облік для українських ФОП і компаній.',
        photo: '/partners/tetiana-priadko.webp',
        worksFor: { name: 'EasyFin', url: 'https://easyfin.in.ua/' },
    },
] as const;
