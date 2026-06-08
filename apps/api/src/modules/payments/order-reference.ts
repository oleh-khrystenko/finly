import { randomBytes } from 'crypto';
import { EXECUTION_PACK_CODES, type ExecutionPackCode } from '@finly/types';

/**
 * WayForPay не має customer-обʼєкта і не повертає наші metadata у колбеку —
 * лише `orderReference`. Тому маршрутизацію вебхука (кому нарахувати, що це за
 * платіж) кодуємо в самому orderReference і декодуємо при розборі підписаного
 * колбеку (значення довірене — підпис уже перевірено).
 *
 * Формат: `fin-<kind>-[<packCode>-]<userId>-<nonce>`. Жоден сегмент не містить
 * дефіса: kind ∈ {sub,pack}, packCode ∈ {basic,max}, userId — 24-hex ObjectId,
 * nonce — hex.
 */

const PREFIX = 'fin';

export const ORDER_KIND = {
    SUBSCRIPTION: 'sub',
    PACK: 'pack',
} as const;

export type OrderKind = (typeof ORDER_KIND)[keyof typeof ORDER_KIND];

export type ParsedOrderReference =
    | { kind: typeof ORDER_KIND.SUBSCRIPTION; userId: string }
    | {
          kind: typeof ORDER_KIND.PACK;
          userId: string;
          packCode: ExecutionPackCode;
      };

function nonce(): string {
    return randomBytes(8).toString('hex');
}

export function buildSubscriptionOrderReference(userId: string): string {
    return `${PREFIX}-${ORDER_KIND.SUBSCRIPTION}-${userId}-${nonce()}`;
}

export function buildPackOrderReference(
    userId: string,
    packCode: ExecutionPackCode
): string {
    return `${PREFIX}-${ORDER_KIND.PACK}-${packCode}-${userId}-${nonce()}`;
}

export function parseOrderReference(ref: string): ParsedOrderReference | null {
    const parts = ref.split('-');
    if (parts[0] !== PREFIX) return null;

    const kind = parts[1];
    if (kind === ORDER_KIND.SUBSCRIPTION) {
        // fin - sub - <userId> - <nonce>
        if (parts.length !== 4) return null;
        return { kind: ORDER_KIND.SUBSCRIPTION, userId: parts[2] };
    }
    if (kind === ORDER_KIND.PACK) {
        // fin - pack - <packCode> - <userId> - <nonce>
        if (parts.length !== 5) return null;
        const packCode = parts[2];
        if (!isPackCode(packCode)) return null;
        return { kind: ORDER_KIND.PACK, userId: parts[3], packCode };
    }
    return null;
}

function isPackCode(value: string): value is ExecutionPackCode {
    return (EXECUTION_PACK_CODES as readonly string[]).includes(value);
}
