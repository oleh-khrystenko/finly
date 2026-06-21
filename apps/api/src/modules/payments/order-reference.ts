import { randomBytes } from 'crypto';
import {
    ONE_OFF_ACCESS_CODES,
    SUBSCRIPTION_PLAN_CODES,
    type OneOffAccessCode,
    type SubscriptionPlanCode,
} from '@finly/types';

/**
 * WayForPay не має customer-обʼєкта і не повертає наші metadata у колбеку —
 * лише `orderReference`. Тому маршрутизацію вебхука (кому нарахувати, що це за
 * платіж) кодуємо в самому orderReference і декодуємо при розборі підписаного
 * колбеку (значення довірене — підпис уже перевірено).
 *
 * Формат: `fin-<kind>-[<code>-]<userId>-<nonce>`. Жоден сегмент не містить
 * дефіса: kind ∈ {sub,oneoff,prorate}, code ∈ {brand,bookkeeper} (oneOffCode для
 * oneoff, targetPlanCode для prorate), userId — 24-hex ObjectId, nonce — hex.
 */

const PREFIX = 'fin';

export const ORDER_KIND = {
    SUBSCRIPTION: 'sub',
    ONE_OFF: 'oneoff',
    PRORATION: 'prorate',
} as const;

export type OrderKind = (typeof ORDER_KIND)[keyof typeof ORDER_KIND];

export type ParsedOrderReference =
    | { kind: typeof ORDER_KIND.SUBSCRIPTION; userId: string }
    | {
          kind: typeof ORDER_KIND.ONE_OFF;
          userId: string;
          oneOffCode: OneOffAccessCode;
      }
    | {
          kind: typeof ORDER_KIND.PRORATION;
          userId: string;
          targetPlanCode: SubscriptionPlanCode;
      };

function nonce(): string {
    return randomBytes(8).toString('hex');
}

export function buildSubscriptionOrderReference(userId: string): string {
    return `${PREFIX}-${ORDER_KIND.SUBSCRIPTION}-${userId}-${nonce()}`;
}

export function buildOneOffOrderReference(
    userId: string,
    oneOffCode: OneOffAccessCode
): string {
    return `${PREFIX}-${ORDER_KIND.ONE_OFF}-${oneOffCode}-${userId}-${nonce()}`;
}

export function buildProrationOrderReference(
    userId: string,
    targetPlanCode: SubscriptionPlanCode
): string {
    return `${PREFIX}-${ORDER_KIND.PRORATION}-${targetPlanCode}-${userId}-${nonce()}`;
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
    if (kind === ORDER_KIND.ONE_OFF) {
        // fin - oneoff - <oneOffCode> - <userId> - <nonce>
        if (parts.length !== 5) return null;
        const oneOffCode = parts[2];
        if (!isOneOffCode(oneOffCode)) return null;
        return { kind: ORDER_KIND.ONE_OFF, userId: parts[3], oneOffCode };
    }
    if (kind === ORDER_KIND.PRORATION) {
        // fin - prorate - <targetPlanCode> - <userId> - <nonce>
        if (parts.length !== 5) return null;
        const targetPlanCode = parts[2];
        if (!isSubscriptionPlanCode(targetPlanCode)) return null;
        return { kind: ORDER_KIND.PRORATION, userId: parts[3], targetPlanCode };
    }
    return null;
}

function isOneOffCode(value: string): value is OneOffAccessCode {
    return (ONE_OFF_ACCESS_CODES as readonly string[]).includes(value);
}

function isSubscriptionPlanCode(value: string): value is SubscriptionPlanCode {
    return (SUBSCRIPTION_PLAN_CODES as readonly string[]).includes(value);
}
