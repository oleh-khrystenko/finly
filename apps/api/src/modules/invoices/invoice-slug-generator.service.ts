import {
    Injectable,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
    RESPONSE_CODE,
    getKyivYearMonth,
    type SlugInput,
    type SlugPreset,
} from '@finly/types';

import { generateRandomTail } from '../businesses/slug-generator.service';
import { effectiveInvoicePurpose } from './purpose-resolver';
import {
    InvoiceSlugCounter,
    InvoiceSlugCounterDocument,
} from './schemas/invoice-slug-counter.schema';
import {
    InvoiceSlugHistory,
    InvoiceSlugHistoryDocument,
} from './schemas/invoice-slug-history.schema';
import { Invoice, InvoiceDocument } from './schemas/invoice.schema';
import { slugifyPurpose } from './transliterate';

/**
 * Sprint 4 §4.1 — генератор фінального invoice-slug-у.
 *
 * **Контракт single public method.**
 *   `generateInvoiceSlug(input, session)` приймає `GenerateInvoiceSlugInput`
 *   (explicit-fields contract — без implicit-lookup-у через інші services чи
 *   читання form-state) і повертає `{ slug, slugPreset, slugCounterScope,
 *   slugCounter }` для запису у `Invoice`-документ. Caller (`InvoicesService.
 *   create`) робить collision-protected insert; race-handling — ідентичний
 *   Sprint 3 patern (see SP-1 "Counter behavior" + Ризик #2).
 *
 * **Counter monotonic per (account, scope) — окрема counter-колекція**
 * (Sprint 4 review fix + Sprint 9 §SP-6 namespace shift). Попередній підхід
 * `MAX(slugCounter)+1` over invoice-документами був зламаний на hard-delete:
 * видалили inv-003 → MAX=2 → counter стрибав назад на 3. Тепер counter живе
 * у `InvoiceSlugCounter`-doc з unique compound `(accountId, scope)` (Sprint 9
 * переніс namespace з businessId на accountId — Privat-account і Mono-account
 * одного бізнесу мають незалежні послідовності). Hard-delete invoice не торкає
 * counter-doc → monotonic invariant виконано.
 *
 * **`session: ClientSession | null` параметр.** Counter increment виконується
 * у сесії invoice-create transaction-у — atomicity з invoice insert: TX
 * abort (race з cascade-delete виграв, validation fail після insert) →
 * counter rollback разом з invoice. Без сесії (`null`) — тест-only path для
 * unit-testing генератора в isolation; у production `InvoicesService.create`
 * завжди передає реальну сесію.
 *
 * **Allocation flow — two-step без upsert** (детальний контракт у
 * `allocateNextCounter` doc-блоці):
 *   - Fast-path: `findOneAndUpdate({...}, {$inc: { last: 1 }})` БЕЗ `upsert`.
 *     Якщо doc існує — атомарний інкремент.
 *   - Lazy bootstrap: doc не знайдено → читаємо `MAX(slugCounter)` over
 *     existing invoices у тому ж scope-i і робимо `create({ last:
 *     legacyMax + 1 })`. Greenfield → `last=1`; post-deploy на existing
 *     data → counter стартує за legacy MAX (без collision проти
 *     partial-unique compound на invoice-схемі). Bootstrap-race (concurrent
 *     перші create-и) → 11000 propagate назовні (НЕ ретраї-имо у тій самій
 *     TX-сесії — duplicate-key abort-ить транзакцію); outer-loop у
 *     `InvoicesService.create` повторює з fresh session, де fast-path вже
 *     бачить committed counter-doc race-winner-а.
 *
 * **Tail — DRY-helper `generateRandomTail()`** з `businesses/slug-generator.service.ts`.
 *
 * **Collision-перевірка по `(accountId, slug)` compound-unique** (Sprint 9 §SP-6)
 * на 11-й спробі — `INVOICE_SLUG_GENERATION_FAILED` 500. Counter-collision (при
 * atomic $inc) теоретично unreachable; partial-unique compound лишається як
 * defense-in-depth + legacy-bootstrap-trip-wire.
 */

export interface GenerateInvoiceSlugInput {
    /**
     * Sprint 9 §SP-6 — `accountId` як primary namespace для counter-aggregation
     * і compound-unique-check `(accountId, slug)`. `businessId` denormalized
     * для counter-doc-у (cascade-business-delete prefix-match).
     */
    businessId: Types.ObjectId;
    accountId: Types.ObjectId;
    /**
     * Discriminated union — explicit | preset | random. Type narrowing у
     * `composeCandidate`-switch дає TS-driven exhaustiveness check.
     */
    slugInput: SlugInput;
    /**
     * Те, що ФОП ввів у формі створення (`null` = "не задав, inheritance з
     * бізнесу"). Використовується тільки для `with-purpose`-пресета — для
     * `simple`/`with-month`/`with-year` ігнорується.
     */
    paymentPurpose: string | null;
    /**
     * Required-fallback для inheritance-логіки `with-purpose`. Sprint 1 entity-
     * Zod гарантує non-empty (`Business.paymentPurposeTemplate.min(1)`), тож
     * generator може покладатись на наявність bottom-string без додаткової
     * перевірки.
     */
    businessPaymentPurposeTemplate: string;
}

export interface GenerateInvoiceSlugResult {
    slug: string;
    /** Sprint 15 — lowercase-нормалізована форма slug (uniqueness/lookup-ключ). */
    slugLower: string;
    slugPreset: SlugPreset | null;
    /**
     * Sprint 4 §4.1 — counter-namespace string для preset-режимів з лічильником
     * (`'simple' | YYYY | 'YYYY-MM'`). `null` для `explicit`/`random`/
     * `with-purpose`. Caller (`InvoicesService.create`, §4.2) зберігає поле у
     * `Invoice`-документ; разом з `slugCounter` утворюють partial-unique
     * compound, що race-блокує counter-collision.
     */
    slugCounterScope: string | null;
    slugCounter: number | null;
}

@Injectable()
export class InvoiceSlugGeneratorService {
    private readonly logger = new Logger(InvoiceSlugGeneratorService.name);
    private static readonly MAX_ATTEMPTS = 10;

    constructor(
        @InjectModel(Invoice.name)
        private readonly invoiceModel: Model<InvoiceDocument>,
        @InjectModel(InvoiceSlugCounter.name)
        private readonly counterModel: Model<InvoiceSlugCounterDocument>,
        @InjectModel(InvoiceSlugHistory.name)
        private readonly historyModel: Model<InvoiceSlugHistoryDocument>
    ) {}

    /**
     * Internal seam for "current time" — boundary-тести замінюють через
     * `jest.spyOn`, не торкаючись глобального clock-у.
     *
     * **Чому окремий метод, а не fake-timers**: V8 `new Date()` без аргументів
     * читає system clock напряму (не викликає `Date.now()`), тож spy на
     * `Date.now` не пробивається. `jest.useFakeTimers().setSystemTime` зморожує
     * і `setTimeout`/`setInterval`, ламаючи Mongoose driver heartbeat. Цей
     * protected-method seam — мінімальний test-injection-point: production
     * code залишається `new Date()`, тести моказують саме цей метод.
     */
    protected now(): Date {
        return new Date();
    }

    async generateInvoiceSlug(
        input: GenerateInvoiceSlugInput,
        session: ClientSession | null
    ): Promise<GenerateInvoiceSlugResult> {
        for (
            let attempt = 1;
            attempt <= InvoiceSlugGeneratorService.MAX_ATTEMPTS;
            attempt++
        ) {
            const candidate = await this.composeCandidate(input, session);
            const slugLower = candidate.slug.toLowerCase();
            // Sprint 15 — uniqueness на `(accountId, slugLower)` + anti-squatting
            // проти `InvoiceSlugHistory` у межах рахунку (recently-renamed invoice
            // тримає старий slug до TTL).
            const [liveTaken, historyTaken] = await Promise.all([
                this.invoiceModel.exists({
                    accountId: input.accountId,
                    slugLower,
                }),
                this.historyModel.exists({
                    accountId: input.accountId,
                    slugLower,
                }),
            ]);
            if (!liveTaken && !historyTaken) {
                return { ...candidate, slugLower };
            }
        }
        this.logger.error(
            `Failed to generate invoice slug for account ${input.accountId.toString()} after ${InvoiceSlugGeneratorService.MAX_ATTEMPTS} attempts; database may be saturated or RNG broken`
        );
        throw new InternalServerErrorException({
            code: RESPONSE_CODE.INVOICE_SLUG_GENERATION_FAILED,
            message: 'Failed to generate unique invoice slug',
        });
    }

    /**
     * Збирає candidate-slug з вхідного `slugInput` + per-business state.
     * `tail` генерується свіжий на кожен retry — collision-loop отримує новий
     * candidate, а не той самий.
     */
    private async composeCandidate(
        input: GenerateInvoiceSlugInput,
        session: ClientSession | null
    ): Promise<Omit<GenerateInvoiceSlugResult, 'slugLower'>> {
        const tail = generateRandomTail();
        switch (input.slugInput.kind) {
            case 'explicit':
                return {
                    slug: `${input.slugInput.humanPart}-${tail}`,
                    slugPreset: null,
                    slugCounterScope: null,
                    slugCounter: null,
                };
            case 'random':
                return {
                    slug: tail,
                    slugPreset: null,
                    slugCounterScope: null,
                    slugCounter: null,
                };
            case 'preset':
                return this.composeForPreset(
                    input.businessId,
                    input.accountId,
                    input.slugInput.preset,
                    effectiveInvoicePurpose(
                        input.paymentPurpose,
                        input.businessPaymentPurposeTemplate
                    ),
                    tail,
                    session
                );
        }
    }

    private async composeForPreset(
        businessId: Types.ObjectId,
        accountId: Types.ObjectId,
        preset: SlugPreset,
        effectivePurpose: string,
        tail: string,
        session: ClientSession | null
    ): Promise<Omit<GenerateInvoiceSlugResult, 'slugLower'>> {
        switch (preset) {
            case 'simple': {
                const scope = 'simple';
                const next = await this.allocateNextCounter(
                    businessId,
                    accountId,
                    scope,
                    session
                );
                return {
                    slug: `inv-${String(next).padStart(3, '0')}-${tail}`,
                    slugPreset: 'simple',
                    slugCounterScope: scope,
                    slugCounter: next,
                };
            }
            case 'with-month': {
                // Kyiv-tz, не UTC — slug-prefix має слідувати локальному
                // звітному періоду ФОП (`docs/product/qr-decisions.md` §4.3.1).
                // Інвойс, виставлений 1 червня 00:30 Київ, отримує prefix
                // `2026-06-`, а не `2026-05-` (як було б з UTC).
                const { year, month } = getKyivYearMonth(this.now());
                const yyyy = year;
                const mm = String(month).padStart(2, '0');
                const scope = `${yyyy}-${mm}`;
                const next = await this.allocateNextCounter(
                    businessId,
                    accountId,
                    scope,
                    session
                );
                return {
                    slug: `${scope}-${String(next).padStart(3, '0')}-${tail}`,
                    slugPreset: 'with-month',
                    slugCounterScope: scope,
                    slugCounter: next,
                };
            }
            case 'with-year': {
                // Kyiv-tz, не UTC — той самий звітний-період invariant, що
                // у `with-month`. Інвойс 1 січня 00:30 Київ → prefix `2027-`,
                // не `2026-`.
                const { year } = getKyivYearMonth(this.now());
                const scope = String(year);
                const next = await this.allocateNextCounter(
                    businessId,
                    accountId,
                    scope,
                    session
                );
                return {
                    slug: `${scope}-${String(next).padStart(3, '0')}-${tail}`,
                    slugPreset: 'with-year',
                    slugCounterScope: scope,
                    slugCounter: next,
                };
            }
            case 'with-purpose': {
                const slugified = slugifyPurpose(effectivePurpose);
                if (slugified.length === 0) {
                    // Fallback на рівень 3: tail-only. slugPreset = null
                    // (не 'with-purpose'), щоб analytics-counter не засмічувався
                    // empty-prefix-варіантами. Counter-fields теж null —
                    // with-purpose не використовує лічильник за визначенням.
                    return {
                        slug: tail,
                        slugPreset: null,
                        slugCounterScope: null,
                        slugCounter: null,
                    };
                }
                return {
                    slug: `${slugified}-${tail}`,
                    slugPreset: 'with-purpose',
                    slugCounterScope: null,
                    slugCounter: null,
                };
            }
        }
    }

    /**
     * Atomic counter allocation per `(accountId, scope)` (Sprint 9 §SP-6) —
     * окрема counter-колекція, незалежна від invoice lifecycle. Hard-delete
     * invoice не торкає counter-doc → monotonic invariant зберігається крізь
     * deletes. `businessId` denormalized у counter-doc-і для прямого
     * cascade-business-delete filter-у без `$lookup` через accounts.
     *
     * **Two-step з lazy bootstrap.**
     *
     *  Step 1 — fast path. `findOneAndUpdate({accountId, scope}, {$inc: {
     *  last: 1 }})` без `upsert`. Якщо counter-doc існує (нормальний steady-
     *  state) — атомарний інкремент, повертаємо нову `last`-value. Concurrent
     *  `$inc`-запити серіалізуються Mongo write-conflict detection-ом.
     *
     *  Step 2 — bootstrap path. Doc не знайдено → можливі два сценарії:
     *    (a) greenfield (зовсім нова scope, без legacy invoices) — counter
     *        стартує з `legacyMax + 1 = 0 + 1 = 1`.
     *    (b) post-deploy на existing data: invoices з counter-значеннями
     *        вже існують, але counter-doc ще не bootstrap-нутий — counter
     *        стартує з `legacyMax + 1`, де `legacyMax = MAX(slugCounter)`
     *        over committed invoices у тому ж `(accountId, scope)`.
     *  Для обох — atomically insert counter-doc з `last = legacyMax + 1`.
     *
     * **Bootstrap-race propagate-иться назовні (review re-fix).**
     * Concurrent bootstrap (два паралельні перші create-и в одному scope-i):
     * один insert проходить, інший падає на `code: 11000` (unique compound
     * `(accountId, scope)`). 11000 НЕ ретраї-имо тут у тій самій сесії —
     * у Mongo TX duplicate-key abort-ить транзакцію server-side, наступний
     * write у тій самій сесії впаде з `TransactionAborted` (а не з committed-
     * counter-state переможця race-у), і ми втратили б correctness. Той
     * самий patern, що `InvoicesService.create` (див. service-doc): 11000
     * propagate назовні через withTransaction → outer-loop у
     * `createOneAttempt` ловить і відкриває **fresh session/transaction**.
     * На fresh session step 1 (fast-path) бачить counter-doc, який щойно
     * committed race-winner-ом, і атомарно `$inc`-ить його далі.
     *
     * **Чому `legacyMax` з invoices, а не лише `0`.** Без bootstrap-у з
     * existing invoices: counter стартує 1, але інвойс з counter=1 вже
     * існує у legacy data → invoice insert падає на partial-unique
     * compound `(accountId, slugCounterScope, slugCounter)` 11000 →
     * retry-on-11000 у `InvoicesService.create` перерахує counter (вже
     * через fast-path $inc → 2) → ще раз collision → retry → ... до
     * MAX_RETRIES=3. Якщо у scope-i 4+ legacy-invoices, перший новий
     * insert падає `INVOICE_SLUG_GENERATION_FAILED`. Lazy bootstrap
     * eliminate-ить цю проблему — стартуємо counter одразу за legacy MAX.
     *
     * **Pre-existing-deletes gap acceptable.** Якщо invoice був hard-
     * deleted ДО deploy-у (counter не знає про нього), `legacyMax` його не
     * побачить → counter може повторно use-нути такий номер на першому
     * post-deploy allocate-ні. Best-effort на migration boundary; всі
     * post-deploy deletes повністю покриті monotonic-invariant-ом.
     */
    private async allocateNextCounter(
        businessId: Types.ObjectId,
        accountId: Types.ObjectId,
        scope: string,
        session: ClientSession | null
    ): Promise<number> {
        // Step 1: fast path — atomic $inc на existing counter-doc (per
        // accountId, scope). Sprint 9 §SP-6.
        const incremented = await this.counterModel
            .findOneAndUpdate(
                { accountId, scope },
                { $inc: { last: 1 } },
                { new: true, session: session ?? undefined }
            )
            .exec();
        if (incremented) return incremented.last;

        // Step 2: bootstrap. Compute legacy MAX over invoices у тому ж
        // (accountId, scope), insert counter-doc з denormalized businessId
        // для cascade-business-delete prefix-match.
        const legacyMax = await this.computeLegacyMax(accountId, scope);
        const created = await this.counterModel.create(
            [{ businessId, accountId, scope, last: legacyMax + 1 }],
            { session: session ?? undefined }
        );
        return created[0].last;
    }

    /**
     * `MAX(slugCounter)` over invoice-документів у заданому `(accountId,
     * scope)` (Sprint 9 §SP-6). Викликається ТІЛЬКИ при bootstrap-i counter-
     * doc-у (one-time per scope per account). На steady-state не торкається —
     * fast-path $inc обходить legacy-aggregation повністю.
     *
     * **Index-prefix-match.** Query використовує prefix двох перших ключів
     * partial-unique compound-index `(accountId, slugCounterScope, slug-
     * Counter)` — Mongo автоматично hits index, без додаткового index-у.
     */
    private async computeLegacyMax(
        accountId: Types.ObjectId,
        scope: string
    ): Promise<number> {
        // Bootstrap-read (one-time per scope) — committed view достатній.
        // Concurrent counter-doc-bootstrap у тому ж (accountId, scope) →
        // unique compound 11000, retry у fast-path-у `allocateNextCounter`.
        const docs = await this.invoiceModel
            .find(
                { accountId, slugCounterScope: scope },
                { slugCounter: 1, _id: 0 }
            )
            .lean()
            .exec();
        let max = 0;
        for (const doc of docs) {
            const n = doc.slugCounter;
            if (typeof n === 'number' && Number.isFinite(n) && n > max) {
                max = n;
            }
        }
        return max;
    }
}
