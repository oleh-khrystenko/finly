'use client';

import { useEffect, useState } from 'react';
import type { SubscriptionPlanCode } from '@finly/types';
import { createSubscriptionCheckout, getCatalog } from '@/shared/api/payments';

/**
 * Sprint 20/22 — спільний апсел підписки поза сторінкою білінгу (slug-flow на
 * трьох entity-сторінках — «Бренд»; ліміт клієнтських отримувачів на
 * `/business/new` — «Агенція»). Ціна env-керована на боці API, тож web НІКОЛИ
 * її не хардкодить — тягне з каталог-ендпоінта (єдине джерело). Кеш на сесію,
 * щоб не смикати API на кожній сторінці.
 */
let catalogPromise: ReturnType<typeof getCatalog> | null = null;
function loadCatalogOnce(): ReturnType<typeof getCatalog> {
    // Кешуємо лише УСПІШНИЙ результат: при збої скидаємо проміс, щоб наступний
    // вхід на сторінку спробував знову, а не залип без ціни на всю сесію.
    return (catalogPromise ??= getCatalog().catch((err) => {
        catalogPromise = null;
        throw err;
    }));
}

/**
 * Підпис primary CTA: «Підписатись · 49 грн/міс». Поки ціна вантажиться або при
 * збої — без числа («Підписатись»): краще без ціни, ніж показати суму, що
 * розходиться з реальним списанням.
 */
export function useSubscribeLabel(planCode: SubscriptionPlanCode): string {
    const [grn, setGrn] = useState<number | null>(null);
    useEffect(() => {
        let active = true;
        loadCatalogOnce()
            .then((catalog) => {
                const plan = catalog.subscriptionPlans.find(
                    (p) => p.code === planCode
                );
                if (active && plan) {
                    setGrn(Math.round(plan.priceAmount / 100));
                }
            })
            .catch(() => {
                /* лишаємо без числа — каталог недоступний */
            });
        return () => {
            active = false;
        };
    }, [planCode]);
    return grn == null ? 'Підписатись' : `Підписатись · ${grn} грн/міс`;
}

/**
 * Прямий checkout підписки з поверненням на `returnPath` (сторінка, з якої
 * прийшов апсел). Лише для користувачів БЕЗ активної підписки — на живому
 * слоті API відповідає 409 `ALREADY_SUBSCRIBED` (зміни тарифу немає, Sprint
 * 22); таким показують перехід на `/billing`. Кидає — caller показує toast.
 */
export async function startSubscriptionCheckout(
    planCode: SubscriptionPlanCode,
    returnPath: string
): Promise<void> {
    const { checkoutUrl } = await createSubscriptionCheckout(
        planCode,
        returnPath
    );
    window.location.href = checkoutUrl;
}
