import { Metadata } from 'next';

import { GuidesHome, loadGuidesTreeSafe } from '@/features/guides';
import { fetchMetadata } from '@/shared/seo/metadata';

export function generateMetadata(): Metadata {
    return fetchMetadata({
        page: 'guides',
        href: 'guides',
        meta: {
            title: 'Гайди Finly: як ФОП приймати оплату від клієнтів',
            description:
                'Практичні гайди для ФОП: як приймати оплату картками, через QR-код і платіжне посилання, як виставити рахунок клієнту і оплата за реквізитами.',
        },
    });
}

export default async function GuidesPage() {
    const tree = await loadGuidesTreeSafe();
    return <GuidesHome tree={tree} />;
}
