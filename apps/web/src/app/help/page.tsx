import { Metadata } from 'next';

import { HelpHome } from '@/features/help-center';
import { fetchMetadata } from '@/shared/seo/metadata';

export function generateMetadata(): Metadata {
    return fetchMetadata({
        page: 'help',
        href: 'help',
        meta: {
            title: 'Довідка Finly — як приймати оплати через QR-коди НБУ',
            description:
                'Як користуватись Finly: створення бізнесу, банківські рахунки, виставлення рахунків клієнтам і платіжні QR-коди за стандартом НБУ.',
        },
    });
}

export default function HelpPage() {
    return <HelpHome />;
}
