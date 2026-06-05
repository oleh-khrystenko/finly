import {
    Rocket,
    Landmark,
    FileText,
    QrCode,
    UserCog,
} from 'lucide-react';
import type { HelpCategory } from '../types';

/**
 * Категорії у порядку відображення. Порядок цього масиву = порядок секцій
 * на індексі та груп у сайдбарі.
 */
export const HELP_CATEGORIES: readonly HelpCategory[] = [
    {
        id: 'getting-started',
        title: 'Перші кроки',
        description: 'Що таке Finly і як почати за кілька хвилин.',
        icon: Rocket,
    },
    {
        id: 'accounts',
        title: 'Банківські рахунки',
        description: 'Як додати рахунок і навіщо їх може бути кілька.',
        icon: Landmark,
    },
    {
        id: 'invoices',
        title: 'Рахунки клієнтам',
        description: 'Як виставляти рахунки і керувати їх нумерацією.',
        icon: FileText,
    },
    {
        id: 'qr-payments',
        title: 'QR-коди та оплата',
        description: 'Як працює платіжний QR і сторінка оплати.',
        icon: QrCode,
    },
    {
        id: 'account-billing',
        title: 'Акаунт і тарифи',
        description: 'Налаштування акаунту та підписка Finly.',
        icon: UserCog,
    },
] as const;
