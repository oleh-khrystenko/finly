import { ReactNode } from 'react';
import type { Metadata } from 'next';

import { AdminGate } from '@/entities/user';

// Адмін-розділ поза індексом: суто внутрішній інструмент.
export const metadata: Metadata = {
    robots: { index: false, follow: false },
};

export default function AdminGuidesLayout({
    children,
}: {
    children: ReactNode;
}) {
    return <AdminGate>{children}</AdminGate>;
}
