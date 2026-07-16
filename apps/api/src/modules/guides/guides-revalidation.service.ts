import { Injectable, Logger } from '@nestjs/common';

import { ENV } from '../../config/env';

/**
 * Sprint 28 — подієва перегенерація публічних сторінок гайдів. Web кешує
 * контент під тегом і фоново оновлює його раз на кілька хвилин (страховка);
 * ця подія скидає кеш одразу після адмін-мутації, що впливає на публіку.
 *
 * Best-effort: збій перегенерації не валить мутацію (стаття вже збережена),
 * фонова інвалідизація підхопить зміну. Логуємо, не пробрасуємо.
 */
// Верхня межа очікування: мутацію вже збережено, тож завислий web не має
// тримати адмін-запит довше кількох секунд — timeout перериває fetch у catch.
const REVALIDATE_TIMEOUT_MS = 5000;

@Injectable()
export class GuidesRevalidationService {
    private readonly logger = new Logger(GuidesRevalidationService.name);

    async revalidate(): Promise<void> {
        const url = `${ENV.WEB_URL.replace(/\/$/, '')}/internal/revalidate-guides`;
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${ENV.REVALIDATE_SECRET}`,
                },
                signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
            });
            if (!res.ok) {
                this.logger.warn(
                    `Guides revalidation returned ${res.status} ${res.statusText}`
                );
            }
        } catch (err) {
            this.logger.warn(
                `Guides revalidation request failed: ${(err as Error).message}`
            );
        }
    }
}
