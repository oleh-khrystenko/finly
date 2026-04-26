import { ReactNode } from 'react';
import { Metadata } from 'next';
import { fetchMetadata } from '@/shared/seo/metadata';
import type { MetaProps } from '@/shared/types/settings';

export async function generateMetadata(
    props: Omit<MetaProps, 'page' | 'href'>,
): Promise<Metadata> {
    return await fetchMetadata({
        ...props,
        page: 'billing',
        href: 'billing',
    });
}

export default function BillingLayout({
    children,
}: {
    children: ReactNode;
}) {
    return <>{children}</>;
}
