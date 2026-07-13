import { randomBytes } from 'crypto';

/**
 * monobank не має customer-обʼєкта і повертає у вебхуку лише наш `reference`
 * (проштовхнутий у `merchantPaymInfo.reference`). Тому маршрутизацію вебхука
 * (кому і що нарахувати) кодуємо в самому reference і декодуємо при розборі
 * підписаної події (значення довірене — підпис уже перевірено).
 *
 * Уніфікований формат: `fin-<kind>-<userId>-<suffix>`. Жоден сегмент не містить
 * дефіса. `kind` ∈ {chk,cyc,pro,crd}, `userId` — 24-hex ObjectId, `suffix` —
 * hex-nonce (checkout / proration / докупівля: кожна унікальна) АБО epoch-мітка
 * межі періоду (детермінований ідентифікатор циклового продовження — claim-first).
 */

const PREFIX = 'fin';

export const ORDER_KIND = {
    /** Перша купівля / відновлення: хостований checkout, захоплення токена. */
    CHECKOUT: 'chk',
    /** Місячне продовження billing-clock (детермінований reference за межею). */
    CYCLE: 'cyc',
    /** Негайна пропорційна доплата при збільшенні ємності. */
    PRORATION: 'pro',
    /** Докупівля прихованого пакета кредитів. */
    CREDIT_PACK: 'crd',
} as const;

export type OrderKind = (typeof ORDER_KIND)[keyof typeof ORDER_KIND];

export interface ParsedOrderReference {
    kind: OrderKind;
    userId: string;
}

const KINDS = new Set<string>(Object.values(ORDER_KIND));

function nonce(): string {
    return randomBytes(8).toString('hex');
}

/** Перша купівля / resume — випадковий nonce (кожна сесія унікальна). */
export function buildCheckoutOrderReference(userId: string): string {
    return `${PREFIX}-${ORDER_KIND.CHECKOUT}-${userId}-${nonce()}`;
}

/**
 * Продовження циклу — ДЕТЕРМІНОВАНИЙ ідентифікатор за межею періоду: однакова
 * межа → однаковий reference. Claim-first ключ: повторний прохід billing-clock
 * (після краху / пропуску) не списує вдруге, бо натикається на наявний запис
 * спроби з тим самим reference.
 */
export function buildCycleOrderReference(
    userId: string,
    periodBoundary: Date
): string {
    return `${PREFIX}-${ORDER_KIND.CYCLE}-${userId}-${periodBoundary.getTime()}`;
}

/** Пропорційна доплата — випадковий nonce (кожна дія унікальна). */
export function buildProrationOrderReference(userId: string): string {
    return `${PREFIX}-${ORDER_KIND.PRORATION}-${userId}-${nonce()}`;
}

/** Докупівля кредитів — випадковий nonce. */
export function buildCreditPackOrderReference(userId: string): string {
    return `${PREFIX}-${ORDER_KIND.CREDIT_PACK}-${userId}-${nonce()}`;
}

export function parseOrderReference(ref: string): ParsedOrderReference | null {
    const parts = ref.split('-');
    if (parts.length !== 4) return null;
    if (parts[0] !== PREFIX) return null;
    if (!KINDS.has(parts[1])) return null;
    return { kind: parts[1] as OrderKind, userId: parts[2] };
}

/**
 * Відновлює межу періоду з детермінованого cycle-reference
 * (`fin-cyc-<userId>-<epochMs>`). null, якщо суфікс не epoch або kind не cycle.
 */
export function cycleBoundaryFromRef(ref: string): Date | null {
    const parts = ref.split('-');
    if (parts.length !== 4 || parts[1] !== ORDER_KIND.CYCLE) return null;
    const ms = Number(parts[3]);
    return Number.isFinite(ms) ? new Date(ms) : null;
}
