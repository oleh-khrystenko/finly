import {
    Injectable,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RESPONSE_CODE } from '@finly/types';

import { generateRandomTail } from '../businesses/slug-generator.service';
import { Account, AccountDocument } from './schemas/account.schema';

/**
 * Sprint 9 §9.1 — генератор Account-slug-у. 8-char A-Za-z0-9 case-sensitive
 * random tail (§SP-10). Reuse `generateRandomTail()` з businesses slug-
 * generator-а — той самий rejection-sampling алгоритм; DRY-helper.
 *
 * **Чому окремий сервіс від business-slug-генератора:**
 *  - Lookup-namespace інший: `(businessId, slug)` compound-unique (account)
 *    vs `slugLower` глобально unique (business).
 *  - Reserved-перевірка НЕ потрібна (account-slug не світиться у URL верхнього
 *    рівня; reserved-list захищає від рекурсивного rewrite middleware-у на
 *    business-slug-рівні).
 *  - Окремий error-code `ACCOUNT_SLUG_GENERATION_FAILED` (домен-isolated від
 *    `SLUG_GENERATION_FAILED`).
 *
 * Max 10 attempts; на 11-й — `500 ACCOUNT_SLUG_GENERATION_FAILED`. При 62⁸ ≈
 * 218 трлн комбінацій і compound `(businessId, slug)` намespace-і — статистично
 * недосяжно.
 */
@Injectable()
export class AccountSlugGeneratorService {
    private readonly logger = new Logger(AccountSlugGeneratorService.name);
    private static readonly MAX_ATTEMPTS = 10;

    constructor(
        @InjectModel(Account.name)
        private readonly accountModel: Model<AccountDocument>
    ) {}

    async generateUnique(businessId: Types.ObjectId): Promise<string> {
        for (
            let attempt = 1;
            attempt <= AccountSlugGeneratorService.MAX_ATTEMPTS;
            attempt++
        ) {
            const candidate = generateRandomTail();
            const taken = await this.accountModel.exists({
                businessId,
                slug: candidate,
            });
            if (!taken) return candidate;
        }
        this.logger.error(
            `Failed to generate account slug for business ${businessId.toString()} after ${AccountSlugGeneratorService.MAX_ATTEMPTS} attempts`
        );
        throw new InternalServerErrorException({
            code: RESPONSE_CODE.ACCOUNT_SLUG_GENERATION_FAILED,
            message: 'Failed to generate unique account slug',
        });
    }
}
