import {
    Injectable,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { Model } from 'mongoose';
import { RESERVED_SLUGS, RESPONSE_CODE } from '@finly/types';

import {
    BusinessSlugHistory,
    BusinessSlugHistoryDocument,
} from './schemas/business-slug-history.schema';
import { Business, BusinessDocument } from './schemas/business.schema';

/**
 * Sprint 4 §4.1 — DRY-helper для invoice-slug-генератора. Той самий
 * rejection-sampling алгоритм, що використовується для бізнес-slug-у;
 * винесений у вільну функцію, щоб `InvoiceSlugGeneratorService` (інший
 * модуль) міг імпортувати без cyclic-DI на цей `Injectable`.
 *
 * **Алфавіт `A-Za-z0-9` (62 chars) × 8 позицій = 218 трлн комбінацій.**
 * При 100k бізнесів імовірність колізії — ~10⁻⁸.
 *
 * **Алгоритм (rejection sampling).** `randomBytes` дає 8-бітні значення
 * `[0, 255]`, ми мапимо тільки `[0, 247]` у алфавіт (62 × 4 = 248 — найбільший
 * множник 62, що ≤ 256). Решта `[248, 255]` відкидаємо — це усуває modulo-
 * bias і дає рівномірний розподіл по алфавіту. Generate більше байтів за
 * раз, щоб амортизувати rejection-overhead (~3% throw-rate).
 *
 * **Чому `crypto.randomBytes` (не `Math.random`).** Передбачуваний RNG дав би
 * послідовні / "вгадувані" slug-и при паралельних create-запитах і відкривав
 * би enumeration-патерн на public-сторінці.
 */
const TAIL_ALPHABET =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const TAIL_LENGTH = 8;

export function generateRandomTail(): string {
    const out: string[] = [];
    const alphabetLength = TAIL_ALPHABET.length;
    const maxUsable = alphabetLength * Math.floor(256 / alphabetLength);

    while (out.length < TAIL_LENGTH) {
        const buffer = randomBytes(TAIL_LENGTH * 2);
        for (let i = 0; i < buffer.length && out.length < TAIL_LENGTH; i++) {
            const byte = buffer[i];
            if (byte < maxUsable) {
                out.push(TAIL_ALPHABET[byte % alphabetLength]);
            }
        }
    }
    return out.join('');
}

/**
 * Free-tier business slug-генератор (Sprint 3 рішення B3).
 *
 * Max 10 retry-спроб гарантує, що legitimate ФОП ніколи не побачить fail-шлях.
 * На 11-й спробі — 500-помилка (`SLUG_GENERATION_FAILED`); статистично
 * недосяжно і означало б реальну проблему з БД (а не з алфавіту).
 *
 * **Чому case-preserved output (а не lowercase) — Sprint 3 рішення E1.**
 * Display-форма slug-а зберігається у `Business.slug`; case-insensitive
 * uniqueness/lookup живе на `Business.slugLower` (Mongoose unique-index).
 * Перевірка collision робиться по lowercase-формі.
 *
 * **Sprint 6 додасть `validateVanitySlug(input)`** — окремий method з тим же
 * reserved + БД-collision check; ніяких змін у `generateRandomSlug` не треба.
 */
@Injectable()
export class SlugGeneratorService {
    private readonly logger = new Logger(SlugGeneratorService.name);
    private static readonly MAX_ATTEMPTS = 10;

    private readonly reservedLowerSet: Set<string>;

    constructor(
        @InjectModel(Business.name)
        private readonly businessModel: Model<BusinessDocument>,
        @InjectModel(BusinessSlugHistory.name)
        private readonly historyModel: Model<BusinessSlugHistoryDocument>
    ) {
        // Замість O(N) `Array.includes` для кожного check-у — O(1) Set lookup.
        // RESERVED_SLUGS уже у lowercase (контракт `packages/types/src/constants/`).
        this.reservedLowerSet = new Set(RESERVED_SLUGS);
    }

    /**
     * Sprint 14 — public для повторного use у `BusinessesService.update`
     * (PATCH `slug` теж проходить reserved-check, рівно як random-generation).
     */
    isReserved(slugLower: string): boolean {
        return this.reservedLowerSet.has(slugLower);
    }

    async generateRandomSlug(): Promise<string> {
        for (
            let attempt = 1;
            attempt <= SlugGeneratorService.MAX_ATTEMPTS;
            attempt++
        ) {
            const candidate = generateRandomTail();
            const candidateLower = candidate.toLowerCase();

            if (this.reservedLowerSet.has(candidateLower)) {
                continue;
            }

            // Sprint 14 — anti-squatting інваріант: random-slug не може
            // дорівнювати historical-entry іншого бізнесу (поки TTL не expired).
            // Для 8-char × 62-alphabet простору вірогідність колізії з history —
            // практично 0, але без перевірки race з recently-renamed-бізнесом
            // створив би 11000 на insert. Cheap двох-індексованих lookup-ів
            // дешевше за recovery з 11000 + retry.
            const [businessTaken, historyTaken] = await Promise.all([
                this.businessModel.exists({ slugLower: candidateLower }),
                this.historyModel.exists({ slugLower: candidateLower }),
            ]);
            if (!businessTaken && !historyTaken) {
                return candidate;
            }
        }

        this.logger.error(
            `Failed to generate slug after ${SlugGeneratorService.MAX_ATTEMPTS} attempts; database may be saturated or RNG broken`
        );
        throw new InternalServerErrorException({
            code: RESPONSE_CODE.SLUG_GENERATION_FAILED,
            message: 'Failed to generate unique slug',
        });
    }
}
