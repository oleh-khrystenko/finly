import type { ReactNode } from 'react';

import { PublicHeader } from '@/widgets/public-header';
import { PublicFooter } from '@/widgets/public-footer';

/**
 * Спільний каркас публічного payment-host-а — обгортає всі три рівні
 * матрьошки (`/{biz}`, `/{biz}/{acc}`, `/{biz}/{acc}/{inv}`) бренд-хедером і
 * слім-футером.
 *
 * Жоден з публічних view не рендерить власний `<main>`, тож layout дає єдиний
 * landmark. `flex-1` штовхає футер до низу viewport-а, коли контент короткий
 * (наприклад empty-state бізнесу без рахунків): root `<body>` —
 * `flex min-h-dvh flex-col`, а ці діти потрапляють у нього напряму (Providers
 * не додає DOM-обгортки).
 */
export default function HostPayLayout({ children }: { children: ReactNode }) {
    return (
        <>
            <PublicHeader />
            <main className="flex-1">{children}</main>
            <PublicFooter />
        </>
    );
}
