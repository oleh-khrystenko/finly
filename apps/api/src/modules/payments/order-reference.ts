import { randomBytes } from 'crypto';
import { ONE_OFF_ACCESS_CODES, type OneOffAccessCode } from '@finly/types';

/**
 * monobank не має customer-обʼєкта і повертає у вебхуку лише наш `reference`
 * (проштовхнутий у `merchantPaymInfo.reference`). Тому маршрутизацію вебхука
 * (кому нарахувати, що це за платіж) кодуємо в самому reference і декодуємо при
 * розборі підписаної події (значення довірене — підпис уже перевірено).
 *
 * Формат: `fin-<kind>-[<code>-]<userId>-<suffix>`. Жоден сегмент не містить
 * дефіса: kind ∈ {sub,oneoff}, code ∈ {brand,bookkeeper} (oneOffCode для oneoff),
 * userId — 24-hex ObjectId, suffix — hex-nonce (checkout) або epoch-мітка періоду
 * (детермінований ідентифікатор продовження billing-clock — claim-first).
 */

const PREFIX = 'fin';

export const ORDER_KIND = {
    SUBSCRIPTION: 'sub',
    ONE_OFF: 'oneoff',
} as const;

export type OrderKind = (typeof ORDER_KIND)[keyof typeof ORDER_KIND];

export type ParsedOrderReference =
    | { kind: typeof ORDER_KIND.SUBSCRIPTION; userId: string }
    | {
          kind: typeof ORDER_KIND.ONE_OFF;
          userId: string;
          oneOffCode: OneOffAccessCode;
      };

function nonce(): string {
    return randomBytes(8).toString('hex');
}

/** Checkout/resume підписки — випадковий nonce (кожна сесія унікальна). */
export function buildSubscriptionOrderReference(userId: string): string {
    return `${PREFIX}-${ORDER_KIND.SUBSCRIPTION}-${userId}-${nonce()}`;
}

/**
 * Продовження billing-clock — ДЕТЕРМІНОВАНИЙ ідентифікатор за межею періоду:
 * однакова межа → однаковий reference. Це claim-first ключ: повторний прохід
 * cron-а (після краху чи пропуску) не списує вдруге, бо натикається на вже
 * наявний запис спроби з тим самим reference.
 */
export function buildRenewalOrderReference(
    userId: string,
    periodBoundary: Date
): string {
    return `${PREFIX}-${ORDER_KIND.SUBSCRIPTION}-${userId}-${periodBoundary.getTime()}`;
}

export function buildOneOffOrderReference(
    userId: string,
    oneOffCode: OneOffAccessCode
): string {
    return `${PREFIX}-${ORDER_KIND.ONE_OFF}-${oneOffCode}-${userId}-${nonce()}`;
}

export function parseOrderReference(ref: string): ParsedOrderReference | null {
    const parts = ref.split('-');
    if (parts[0] !== PREFIX) return null;

    const kind = parts[1];
    if (kind === ORDER_KIND.SUBSCRIPTION) {
        // fin - sub - <userId> - <suffix>
        if (parts.length !== 4) return null;
        return { kind: ORDER_KIND.SUBSCRIPTION, userId: parts[2] };
    }
    if (kind === ORDER_KIND.ONE_OFF) {
        // fin - oneoff - <oneOffCode> - <userId> - <nonce>
        if (parts.length !== 5) return null;
        const oneOffCode = parts[2];
        if (!isOneOffCode(oneOffCode)) return null;
        return { kind: ORDER_KIND.ONE_OFF, userId: parts[3], oneOffCode };
    }
    return null;
}

function isOneOffCode(value: string): value is OneOffAccessCode {
    return (ONE_OFF_ACCESS_CODES as readonly string[]).includes(value);
}
