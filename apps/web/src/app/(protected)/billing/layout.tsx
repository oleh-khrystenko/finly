import { ReactNode } from 'react';
import { Metadata } from 'next';
import { fetchMetadata } from '@/shared/seo/metadata';

export function generateMetadata(): Metadata {
    return fetchMetadata({
        page: 'billing',
        href: 'billing',
        meta: {
            title: 'Білінг',
            description: 'Керуйте підпискою та виконаннями Finly.',
        },
    });
}

export default function BillingLayout({
    children,
}: {
    children: ReactNode;
}) {
    return <>{children}</>;
}
