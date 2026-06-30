import { Metadata } from 'next';

import { HelpHome } from '@/features/help-center';
import { fetchMetadata } from '@/shared/seo/metadata';

export function generateMetadata(): Metadata {
    return fetchMetadata({
        page: 'help',
        href: 'help',
        meta: {
            title: 'Довідка Finly: як приймати оплату через QR-код НБУ',
            description:
                'Як приймати оплату через платіжний QR-код за стандартом НБУ: створення отримувача з реквізитами, виставлення рахунків клієнтам і платіжна сторінка у Finly.',
        },
    });
}

export default function HelpPage() {
    return <HelpHome />;
}
