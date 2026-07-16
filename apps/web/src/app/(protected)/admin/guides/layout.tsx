import { ReactNode } from 'react';
import type { Metadata } from 'next';

import { AdminGuideGate } from '@/features/admin-guides';

// Адмін-розділ поза індексом: суто внутрішній інструмент.
export const metadata: Metadata = {
    robots: { index: false, follow: false },
};

export default function AdminGuidesLayout({
    children,
}: {
    children: ReactNode;
}) {
    return <AdminGuideGate>{children}</AdminGuideGate>;
}
