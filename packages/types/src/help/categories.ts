import type { HelpCategory } from './types';

/** Categories in display order (order of this array = order of sections / nav). */
export const HELP_CATEGORIES: readonly HelpCategory[] = [
    {
        id: 'getting-started',
        title: 'Перші кроки',
        description: 'Що таке Finly і як почати за кілька хвилин.',
    },
    {
        id: 'accounts',
        title: 'Банківські рахунки',
        description: 'Як додати рахунок і навіщо їх може бути кілька.',
    },
    {
        id: 'invoices',
        title: 'Рахунки клієнтам',
        description: 'Як виставляти рахунки і керувати їх нумерацією.',
    },
    {
        id: 'qr-payments',
        title: 'QR-коди та оплата',
        description: 'Як працює платіжний QR і сторінка оплати.',
    },
    {
        id: 'account-billing',
        title: 'Акаунт і тарифи',
        description: 'Налаштування акаунту та підписка Finly.',
    },
] as const;
