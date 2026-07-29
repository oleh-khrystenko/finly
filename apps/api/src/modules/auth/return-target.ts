import { BadRequestException } from '@nestjs/common';
import { isAllowedReturnTarget, RESPONSE_CODE } from '@finly/types';

import { ENV } from '../../config/env';

/**
 * Sprint 30 — рівно два наші origin-и, куди дозволено повертати людину після
 * входу: кабінет і публічний pay-хост. Список береться з конфігурації, тобто
 * автоматично коректний у dev, staging і проді.
 */
export const ALLOWED_RETURN_ORIGINS: readonly string[] = [
    ENV.WEB_URL,
    ENV.PAY_PUBLIC_URL,
];

/**
 * Ціль повернення приходить з клієнта (кнопка «Увійти» на публічній сторінці
 * кладе туди свою адресу), а потрапляє у лист із нашого домену. Довільний
 * зовнішній домен тут означав би відкритий редірект з довіреного домену —
 * готовий інструмент фішингу, тому все, крім своїх шляхів і двох відомих
 * origin-ів, відхиляємо на вході.
 */
export function assertAllowedReturnTarget(target: string): void {
    if (!isAllowedReturnTarget(target, ALLOWED_RETURN_ORIGINS)) {
        throw new BadRequestException({
            code: RESPONSE_CODE.INVALID_REDIRECT_TARGET,
            message: 'Invalid redirect target',
        });
    }
}
