'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import UiFullPageLoader from '@/shared/ui/UiFullPageLoader';
import { getMe } from '@/shared/api';
import { useAuthStore } from '@/entities/user';

export default function BillingSuccessPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const handledRef = useRef(false);

    useEffect(() => {
        if (handledRef.current) return;
        handledRef.current = true;

        const handle = async () => {
            try {
                const user = await getMe();
                useAuthStore.getState().setUser(user);
                toast.success('Оплату здійснено');
            } catch {
                toast.error(
                    'Не вдалося оновити дані. Перезавантажте сторінку.'
                );
            }
            const returnPath = searchParams.get('returnPath');
            const safeReturn =
                returnPath?.startsWith('/') && !returnPath.startsWith('//')
                    ? returnPath
                    : null;
            router.replace(safeReturn || '/billing');
        };

        void handle();
    }, [router, searchParams]);

    return <UiFullPageLoader message="Обробка оплати…" />;
}
