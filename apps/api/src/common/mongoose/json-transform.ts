import type { Schema } from 'mongoose';

/**
 * Sprint 4 §4.4 fix — стандартний `toJSON`/`toObject`-transform для всіх Mongoose
 * schemas, що повертаються через REST/JSON у frontend.
 *
 * **Контракт**:
 *  - `_id: ObjectId` → `id: string` (string-cast через `.toString()`).
 *  - `__v` (Mongoose version key) — strip.
 *
 * **Чому не `virtuals: true`**: Mongoose default додає virtual `id`-getter, що
 * у `toJSON({ virtuals: true })` дав би **обидва** поля (`id` + `_id`),
 * подвоюючи payload. Custom transform повертає тільки `id`-string і видаляє
 * `_id` — payload точно відповідає `id: string`-Zod-entity-shape з
 * `@finly/types`.
 *
 * **Чому глобальний transform, а не per-controller mapper**: будь-який
 * code-path, що повертає Mongoose document у JSON (controller envelope,
 * `JSON.stringify`, supertest assertions у тестах), отримує consistent
 * shape без явного `.toJSON()`-call-у. Aggregation-pipeline-output
 * (`businessModel.aggregate(...)`) — ОКРЕМА відповідальність: aggregate
 * повертає plain objects без Mongoose-transform-у; для нього треба
 * `$addFields: { id: { $toString: '$_id' } } + $unset: ['_id', '__v']`-stage
 * у самому pipeline (див. `getOwnedAndManagedWithInvoicesCount`).
 *
 * **Mongoose document instance access** (`doc._id`) лишається без змін —
 * transform впливає лише на JSON-serialization. Тести, що звертаються до
 * `doc._id` напряму (наприклад, для compound-key lookups), працюють як були.
 */
export function applyJsonTransform<T = unknown>(schema: Schema<T>): void {
    const transform = (
        _doc: unknown,
        ret: Record<string, unknown>
    ): Record<string, unknown> => {
        if (ret._id !== undefined && ret._id !== null) {
            ret.id = (ret._id as { toString(): string }).toString();
            delete ret._id;
        }
        delete ret.__v;
        return ret;
    };
    schema.set('toJSON', { virtuals: false, transform });
    schema.set('toObject', { virtuals: false, transform });
}
