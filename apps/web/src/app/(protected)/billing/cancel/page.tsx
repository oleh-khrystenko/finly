'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import UiFullPageLoader from '@/shared/ui/UiFullPageLoader';

export default function BillingCancelPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const handledRef = useRef(false);

    useEffect(() => {
        if (handledRef.current) return;
        handledRef.current = true;

        toast.info('Оплату скасовано');
        const returnPath = searchParams.get('returnPath');
        const safeReturn =
            returnPath?.startsWith('/') && !returnPath.startsWith('//')
                ? returnPath
                : null;
        router.replace(safeReturn || '/billing');
    }, [router, searchParams]);

    return <UiFullPageLoader message="Обробка оплати…" />;
}
