import { ReactNode } from 'react';
import type { Metadata } from 'next';

import { AdminGate } from '@/entities/user';

// Адмін-розділ поза індексом: суто внутрішній інструмент.
export const metadata: Metadata = {
    robots: { index: false, follow: false },
};

/**
 * Спільний layout усієї адмін-зони (`/admin/*`): role-gate плюс `noindex`.
 * Один на весь сегмент, а не по копії на кожен розділ, інакше новий розділ
 * легко завести без гейта, просто забувши створити власний layout.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
    return <AdminGate>{children}</AdminGate>;
}
