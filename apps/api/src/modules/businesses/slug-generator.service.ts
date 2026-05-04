import {
    Injectable,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { Model } from 'mongoose';
import { RESERVED_SLUGS, RESPONSE_CODE } from '@finly/types';

import { Business, BusinessDocument } from './schemas/business.schema';

/**
 * Free-tier slug-генератор (Sprint 3 рішення B3).
 *
 * **Алфавіт `A-Za-z0-9` (62 chars) × 8 позицій = 218 трлн комбінацій.**
 * При 100k бізнесів імовірність колізії — ~10⁻⁸; max 10 retry-спроб гарантує,
 * що legitimate ФОП ніколи не побачить fail-шлях. На 11-й спробі — 500-помилка
 * (`SLUG_GENERATION_FAILED`); статистично недосяжно і означало б реальну
 * проблему з БД (а не з алфавіту).
 *
 * **Чому case-preserved output (а не lowercase) — Sprint 3 рішення E1.**
 * Display-форма slug-а зберігається у `Business.slug`; case-insensitive
 * uniqueness/lookup живе на `Business.slugLower` (Mongoose unique-index).
 * Перевірка collision робиться по lowercase-формі.
 *
 * **Чому `crypto.randomBytes` (не `Math.random`).** Передбачуваний RNG дав би
 * послідовні / "вгадувані" slug-и при паралельних create-запитах і відкривав
 * би enumeration-патерн на public-сторінці (ризик post-MVP, але дешевше
 * закрити одразу).
 *
 * **Sprint 6 додасть `validateVanitySlug(input)`** — окремий method з тим же
 * reserved + БД-collision check; ніяких змін у `generateRandomSlug` не треба.
 */
@Injectable()
export class SlugGeneratorService {
    private readonly logger = new Logger(SlugGeneratorService.name);
    private static readonly ALPHABET =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    private static readonly LENGTH = 8;
    private static readonly MAX_ATTEMPTS = 10;

    private readonly reservedLowerSet: Set<string>;

    constructor(
        @InjectModel(Business.name)
        private readonly businessModel: Model<BusinessDocument>
    ) {
        // Замість O(N) `Array.includes` для кожного check-у — O(1) Set lookup.
        // RESERVED_SLUGS уже у lowercase (контракт `packages/types/src/constants/`).
        this.reservedLowerSet = new Set(RESERVED_SLUGS);
    }

    async generateRandomSlug(): Promise<string> {
        for (
            let attempt = 1;
            attempt <= SlugGeneratorService.MAX_ATTEMPTS;
            attempt++
        ) {
            const candidate = this.generateRandomString();
            const candidateLower = candidate.toLowerCase();

            if (this.reservedLowerSet.has(candidateLower)) {
                continue;
            }

            // Lookup по slugLower — case-insensitive uniqueness invariant.
            // `exists` — найдешевший Mongo query (server-side hit на index,
            // повертає лише `_id`).
            const taken = await this.businessModel.exists({
                slugLower: candidateLower,
            });
            if (!taken) {
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

    /**
     * Cryptographically secure random string з алфавіту `A-Za-z0-9`.
     *
     * Реалізація — rejection sampling: `randomBytes` дає 8-бітні значення
     * `[0, 255]`, ми мапимо тільки `[0, 247]` у алфавіт (62 × 4 = 248 — найбільший
     * множник 62, що ≤ 256). Решта `[248, 255]` відкидаємо і re-roll-имо. Це
     * дає рівномірний розподіл по алфавіту без modulo-bias-у. Generate більше
     * байтів за раз, щоб амортизувати rejection-overhead (~3% throw-rate).
     */
    private generateRandomString(): string {
        const out: string[] = [];
        const alphabetLength = SlugGeneratorService.ALPHABET.length;
        const maxUsable = alphabetLength * Math.floor(256 / alphabetLength);

        while (out.length < SlugGeneratorService.LENGTH) {
            const buffer = randomBytes(
                SlugGeneratorService.LENGTH * 2 // amortize rejection
            );
            for (
                let i = 0;
                i < buffer.length && out.length < SlugGeneratorService.LENGTH;
                i++
            ) {
                const byte = buffer[i];
                if (byte < maxUsable) {
                    out.push(
                        SlugGeneratorService.ALPHABET[byte % alphabetLength]
                    );
                }
            }
        }
        return out.join('');
    }
}
