import { useEffect, useState } from 'react';
import { createSubscriptionCheckout, getCatalog } from '@/shared/api/payments';

/**
 * Sprint 20/22 — спільний апсел на тариф «Бренд» (slug-flow на трьох сторінках).
 * Ціна тепер env-керована на боці API, тож web НІКОЛИ її не хардкодить — тягне з
 * каталог-ендпоінта (єдине джерело). Кеш на сесію, щоб не смикати API на кожній
 * сторінці.
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
export function useBrandSubscribeLabel(): string {
    const [grn, setGrn] = useState<number | null>(null);
    useEffect(() => {
        let active = true;
        loadCatalogOnce()
            .then((catalog) => {
                const brand = catalog.subscriptionPlans.find(
                    (p) => p.code === 'brand'
                );
                if (active && brand) {
                    setGrn(Math.round(brand.priceAmount / 100));
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
 * Прямий checkout підписки «Бренд» з поверненням на `returnPath` (сторінка
 * сутності, де чекає бронь). Після оплати намір застосовується автоматично
 * (`useApplyPendingSlug`). Кидає — caller показує toast і лишає бронь чинною.
 */
export async function startBrandCheckout(returnPath: string): Promise<void> {
    const { checkoutUrl } = await createSubscriptionCheckout(
        'brand',
        returnPath
    );
    window.location.href = checkoutUrl;
}
