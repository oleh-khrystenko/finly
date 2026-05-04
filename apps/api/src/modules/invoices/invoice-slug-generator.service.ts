import {
    Injectable,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
    RESPONSE_CODE,
    getKyivYearMonth,
    type SlugInput,
    type SlugPreset,
} from '@finly/types';

import { generateRandomTail } from '../businesses/slug-generator.service';
import { effectiveInvoicePurpose } from './purpose-resolver';
import { Invoice, InvoiceDocument } from './schemas/invoice.schema';
import { slugifyPurpose } from './transliterate';

/**
 * Sprint 4 §4.1 — генератор фінального invoice-slug-у.
 *
 * **Контракт single public method.**
 *   `generateInvoiceSlug(input)` приймає `GenerateInvoiceSlugInput`
 *   (explicit-fields contract — без implicit-lookup-у через інші services чи
 *   читання form-state) і повертає `{ slug, slugPreset }` для запису у
 *   `Invoice`-документ. Caller (`InvoicesService.create`) робить collision-
 *   protected insert; race-handling — ідентичний Sprint 3 patern (see SP-1
 *   "Counter behavior" + Ризик #2).
 *
 * **Counter monotonic per (business, preset, [year/month]).** Реалізація без
 * окремого counter-поля у БД (зайве і дрейфує) — single-aggregation lookup
 * у service-методі. Filter `{ businessId, slugPreset, …extra }` —
 * **двокомпонентний** для всіх counter-пресетів (SP-1 "Counter behavior"):
 * explicit-mode записує `slugPreset = null`, і його humanPart-формою (напр.
 * `inv-999`, що match-ить `simple`-regex) НЕ повинен забруднювати counter
 * для `simple` пресету. Без `slugPreset`-фільтра наступний `simple`-counter
 * стрибнув би на `999+1=1000`, ламаючи monotonic per-preset namespace.
 *
 * **Tail — DRY-helper `generateRandomTail()`** з `businesses/slug-generator.service.ts`
 * (Sprint 4 §4.1: повторне використання Sprint 3 алгоритму).
 *
 * **Collision-перевірка по `(businessId, slug)` compound-unique.** На 11-й
 * спробі — `INVOICE_SLUG_GENERATION_FAILED` 500 (статистично недосяжно для
 * tail-варіанту: 218T комбінацій × per-business namespace; для preset з
 * counter-ом — counter гарантує uniqueness без collision-у на нормальному
 * шляху).
 */

export interface GenerateInvoiceSlugInput {
    /**
     * Namespace для counter-aggregation і compound-unique-check. Передається
     * як ObjectId (а не string), бо `InvoicesService.create` уже має
     * `business._id` після `BusinessAccessGuard`-attach-у.
     */
    businessId: Types.ObjectId;
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
        private readonly invoiceModel: Model<InvoiceDocument>
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
        input: GenerateInvoiceSlugInput
    ): Promise<GenerateInvoiceSlugResult> {
        for (
            let attempt = 1;
            attempt <= InvoiceSlugGeneratorService.MAX_ATTEMPTS;
            attempt++
        ) {
            const candidate = await this.composeCandidate(input);
            const taken = await this.invoiceModel.exists({
                businessId: input.businessId,
                slug: candidate.slug,
            });
            if (!taken) {
                return candidate;
            }
        }
        this.logger.error(
            `Failed to generate invoice slug for business ${input.businessId.toString()} after ${InvoiceSlugGeneratorService.MAX_ATTEMPTS} attempts; database may be saturated or RNG broken`
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
        input: GenerateInvoiceSlugInput
    ): Promise<GenerateInvoiceSlugResult> {
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
                    input.slugInput.preset,
                    effectiveInvoicePurpose(
                        input.paymentPurpose,
                        input.businessPaymentPurposeTemplate
                    ),
                    tail
                );
        }
    }

    private async composeForPreset(
        businessId: Types.ObjectId,
        preset: SlugPreset,
        effectivePurpose: string,
        tail: string
    ): Promise<GenerateInvoiceSlugResult> {
        switch (preset) {
            case 'simple': {
                const scope = 'simple';
                const next = await this.nextCounterByScope(
                    businessId,
                    scope
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
                const next = await this.nextCounterByScope(
                    businessId,
                    scope
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
                const next = await this.nextCounterByScope(
                    businessId,
                    scope
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
     * `MAX(slugCounter)+1` over invoice-документів у заданому
     * counter-namespace (`(businessId, slugCounterScope)`).
     *
     * **Парний з partial-unique compound-index** `(businessId, slugCounterScope,
     * slugCounter)` (Mongoose schema). Read дає optimistic candidate-номер;
     * insert або проходить, або падає на 11000 (race-collision проти
     * паралельного insert-у з тим самим counter-ом), тригернувши retry-on-
     * 11000 у caller-side (`InvoicesService.create`, §4.2).
     *
     * **Чому find+iterate JS-side, а не aggregation `$max`.** На MVP-масштабі
     * (десятки invoices per business per scope) overhead однаковий, але
     * JS-iterate простіший і без edge-case-ів `$max` на null-fields. Sprint 6
     * при масштабі 10k+ invoices — переходимо на `findOne(...).sort({
     * slugCounter: -1 }).limit(1)` (точкове read під indexом) або окремий
     * counter-document; interface цього метода залишається той самий.
     *
     * **Index-prefix-match.** Query `find({ businessId, slugCounterScope })`
     * використовує prefix двох перших ключів compound-index-у — Mongo
     * автоматично hits index, окремий compound-index не потрібен.
     */
    private async nextCounterByScope(
        businessId: Types.ObjectId,
        slugCounterScope: string
    ): Promise<number> {
        const docs = await this.invoiceModel
            .find(
                { businessId, slugCounterScope },
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
        return max + 1;
    }
}
