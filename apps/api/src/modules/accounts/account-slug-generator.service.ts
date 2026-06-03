import {
    Injectable,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RESPONSE_CODE } from '@finly/types';

import { generateRandomTail } from '../businesses/slug-generator.service';
import {
    AccountSlugHistory,
    AccountSlugHistoryDocument,
} from './schemas/account-slug-history.schema';
import { Account, AccountDocument } from './schemas/account.schema';

/**
 * Sprint 9 §9.1 — генератор Account-slug-у. 8-char A-Za-z0-9 random tail.
 * Reuse `generateRandomTail()` з businesses slug-generator-а — той самий
 * rejection-sampling алгоритм; DRY-helper.
 *
 * **Чому окремий сервіс від business-slug-генератора:**
 *  - Lookup-namespace інший: `(businessId, slugLower)` compound-unique (account)
 *    vs `slugLower` глобально unique (business).
 *  - Reserved-перевірка НЕ потрібна (account-slug — вкладений сегмент URL, не
 *    конфліктує з top-level route-namespace-ами апки).
 *  - Окремий error-code `ACCOUNT_SLUG_GENERATION_FAILED` (домен-isolated).
 *
 * **Sprint 15 — uniqueness на `slugLower` + history.** Candidate перевіряється
 * проти живих account-ів і `AccountSlugHistory` у межах бізнесу (anti-squatting):
 * без history-check random tail міг би collide-ити з recently-renamed-рахунком
 * → 11000 на insert. Для 62⁸ простору колізія практично 0, але cheap двох
 * індексованих lookup-ів дешевше за recovery з 11000.
 *
 * Max 10 attempts; на 11-й — `500 ACCOUNT_SLUG_GENERATION_FAILED`.
 */
@Injectable()
export class AccountSlugGeneratorService {
    private readonly logger = new Logger(AccountSlugGeneratorService.name);
    private static readonly MAX_ATTEMPTS = 10;

    constructor(
        @InjectModel(Account.name)
        private readonly accountModel: Model<AccountDocument>,
        @InjectModel(AccountSlugHistory.name)
        private readonly historyModel: Model<AccountSlugHistoryDocument>
    ) {}

    async generateUnique(businessId: Types.ObjectId): Promise<string> {
        for (
            let attempt = 1;
            attempt <= AccountSlugGeneratorService.MAX_ATTEMPTS;
            attempt++
        ) {
            const candidate = generateRandomTail();
            const slugLower = candidate.toLowerCase();
            const [liveTaken, historyTaken] = await Promise.all([
                this.accountModel.exists({ businessId, slugLower }),
                this.historyModel.exists({ businessId, slugLower }),
            ]);
            if (!liveTaken && !historyTaken) return candidate;
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
