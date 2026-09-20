'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
    CARD_VERIFICATION_STATUS,
    RESPONSE_CODE,
    type CardVerificationResult,
} from '@finly/types';
import {
    extractApiErrorCode,
    getApiMessage,
    resolveCardVerification,
} from '@/shared/api';
import { isValidRedirect, navigateToReturnTarget } from '@/shared/lib/redirect';
import UiFullPageLoader from '@/shared/ui/UiFullPageLoader';

/**
 * Сповіщення банку і повернення платника надходять майже одночасно, а поки
 * сервер обробляє сповіщення (стирає стару картку в банку, надсилає лист, у
 * боргу ще й списує його), білінг платника зайнятий і відповідає «операція вже
 * виконується». Для платника це не відмова прив'язки, а те саме «банк ще не
 * відповів»: чекаємо і питаємо знову. Інакше успішна заміна картки
 * закінчувалась би повідомленням про помилку з пропозицією ввести картку ще
 * раз.
 */
const BUSY_RETRY_DELAY_MS = 2_000;
const BUSY_ATTEMPTS = 3;

const wait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

async function resolveWhenBillingFree(): Promise<CardVerificationResult> {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await resolveCardVerification();
        } catch (err) {
            const busy =
                extractApiErrorCode(err) ===
                RESPONSE_CODE.BILLING_OPERATION_IN_PROGRESS;
            if (!busy) throw err;
            // Обробка сповіщення затягнулась: результат є, ми його просто не
            // побачили. Кажемо «ще перевіряється» замість помилки — картку
            // покаже екран білінгу, щойно обробка завершиться.
            if (attempt >= BUSY_ATTEMPTS) {
                return { status: CARD_VERIFICATION_STATUS.PENDING };
            }
            await wait(BUSY_RETRY_DELAY_MS);
        }
    }
}

/**
 * Sprint 43 — повернення зі сторінки банку після прив'язки картки. Гроші тут не
 * рухались, тож «Оплату здійснено» було б неправдою. Результат перевірки картки
 * питаємо у сервера: якщо сповіщення банку ще не дійшло, сервер сам дозвірить
 * його в банку.
 */
export default function BillingCardReturnPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const handledRef = useRef(false);

    useEffect(() => {
        if (handledRef.current) return;
        handledRef.current = true;

        const handle = async () => {
            try {
                const { status } = await resolveWhenBillingFree();
                if (status === CARD_VERIFICATION_STATUS.SAVED) {
                    toast.success('Картку збережено');
                } else if (status === CARD_VERIFICATION_STATUS.FAILED) {
                    toast.error(
                        "Не вдалося прив'язати картку. Спробуйте ще раз"
                    );
                } else {
                    toast.info(
                        'Банк ще перевіряє картку. Оновіть сторінку за хвилину'
                    );
                }
            } catch (err) {
                toast.error(
                    getApiMessage(extractApiErrorCode(err), 'payments')
                );
            }
            const returnPath = searchParams.get('returnPath');
            const target =
                returnPath && isValidRedirect(returnPath)
                    ? returnPath
                    : '/billing';
            navigateToReturnTarget(router, target, 'replace');
        };

        void handle();
    }, [router, searchParams]);

    return <UiFullPageLoader message="Перевірка картки…" />;
}
