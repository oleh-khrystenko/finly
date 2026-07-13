'use client';

import { useEffect, useState } from 'react';
import { BILLING_UNIVERSE, RESPONSE_CODE } from '@finly/types';
import { getCatalog, startCheckout } from '@/shared/api/payments';
import { extractApiErrorCode } from '@/shared/api';

/**
 * Sprint 27 — slug-upsell поза сторінкою білінгу (три entity-сторінки кабінету):
 * бронь імені веде до купівлі Бренду для ЦЬОГО бізнесу. Ціна env-керована на боці
 * API (per-business), web її НІКОЛИ не хардкодить — тягне з каталог-ендпоінта.
 * Кеш на сесію, щоб не смикати API на кожній сторінці.
 */
let catalogPromise: ReturnType<typeof getCatalog> | null = null;
function loadCatalogOnce(): ReturnType<typeof getCatalog> {
    return (catalogPromise ??= getCatalog().catch((err) => {
        catalogPromise = null;
        throw err;
    }));
}

/**
 * Підпис primary CTA: «Підписатись · 49 грн/міс». Поки ціна вантажиться або при
 * збої — без числа: краще без ціни, ніж сума, що розходиться з реальним списанням.
 */
export function useSubscribeLabel(): string {
    const [grn, setGrn] = useState<number | null>(null);
    useEffect(() => {
        let active = true;
        loadCatalogOnce()
            .then((catalog) => {
                if (active) {
                    setGrn(Math.round(catalog.brand.pricePerBusiness / 100));
                }
            })
            .catch(() => {
                /* лишаємо без числа — каталог недоступний */
            });
        return () => {
            active = false;
        };
    }, []);
    return grn == null ? 'Підписатись' : `Підписатись · ${grn} грн/міс`;
}

/**
 * Купівля Бренду для конкретного бізнесу з поверненням на `returnPath` (сторінка,
 * з якої прийшов апсел). Перша купівля → хостований checkout з прикріпленням
 * цього бізнесу. Якщо у платника вже є живий профіль, API відповідає
 * `BILLING_ALREADY_ACTIVE` — тоді ведемо на `/billing`: розширення пакета і
 * прикріплення цього бізнесу робиться там (слот додається доплатою за токеном,
 * не повторним checkout-ом). Інші помилки кидаються — caller показує toast.
 */
export async function startSubscriptionCheckout(
    businessId: string,
    returnPath: string
): Promise<void> {
    try {
        const { checkoutUrl } = await startCheckout({
            universe: BILLING_UNIVERSE.BRAND,
            capacity: 1,
            attachBusinessId: businessId,
            returnPath,
        });
        window.location.href = checkoutUrl;
    } catch (err) {
        if (
            extractApiErrorCode(err) === RESPONSE_CODE.BILLING_ALREADY_ACTIVE
        ) {
            window.location.href = '/billing';
            return;
        }
        throw err;
    }
}
