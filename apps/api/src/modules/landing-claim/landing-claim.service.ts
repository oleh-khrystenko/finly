import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
    RESPONSE_CODE,
    mapLandingDraftToCreateBusinessRequest,
    type LandingDraft,
} from '@finly/types';

import { AccountsService } from '../accounts/accounts.service';
import type { BusinessDocument } from '../businesses/schemas/business.schema';
import { BusinessesService } from '../businesses/businesses.service';
import { UsersService } from '../users/users.service';

/**
 * Sprint 10 §10.1 — discriminated tuple-result для 2-sequential anon-claim
 * flow. AuthService merge-ить ці поля у `AuthResponseSchema` (sprint §SP-7
 * discriminated narrowing на `claimState`).
 */
export type LandingClaimResult =
    | {
          claimState: 'success';
          claimedBusinessSlug: string;
          claimedAccountSlug: string;
      }
    | {
          claimState: 'business-failed';
          failedClaimDraft: LandingDraft;
      }
    | {
          claimState: 'account-failed';
          partialBusinessSlug: string;
          failedClaimDraft: LandingDraft;
      };

export interface LandingClaimContext {
    userId: string;
    isBookkeeperMode: boolean;
}

/**
 * Sprint 10 §10.1 — separation of concerns від `AuthService`. Інкапсулює
 * 2-sequential anon-claim з discriminated tuple-результатом.
 *
 * **Чому success-with-state, а не throw**: claim-failure НЕ блокує auth.
 * Користувач уже автентикований у `verifyMagicLink`-flow; claim — додатковий
 * post-auth step. Failure у claim повертається як discriminated `claimState`,
 * frontend читає його для form-recovery-redirect-у.
 *
 * **Залежить від `BusinessesModule` + `AccountsModule`** (one-way DAG: ці
 * модулі НЕ знають про `LandingClaimModule`). НЕ залежить від `AuthModule`
 * напряму — приймає опаковий `ctx`-param з уже-resolved `userId` +
 * `isBookkeeperMode`; caller (`AuthService.verifyMagicLink`) резолвить їх з
 * `UserDocument`.
 */
@Injectable()
export class LandingClaimService {
    private readonly logger = new Logger(LandingClaimService.name);

    constructor(
        private readonly businessesService: BusinessesService,
        private readonly accountsService: AccountsService,
        private readonly usersService: UsersService
    ) {}

    async attemptLandingClaim(
        ctx: LandingClaimContext,
        draft: LandingDraft,
        claimIdempotencyKey: string
    ): Promise<LandingClaimResult> {
        const createDto = mapLandingDraftToCreateBusinessRequest(
            draft,
            claimIdempotencyKey
        );

        let business: BusinessDocument;
        try {
            business = await this.businessesService.create(
                ctx.userId,
                createDto,
                ctx.isBookkeeperMode
            );
        } catch (err) {
            this.logClaimFailure('POST1', ctx.userId, err);
            return {
                claimState: 'business-failed',
                failedClaimDraft: draft,
            };
        }

        try {
            const account = await this.accountsService.create(business, {
                iban: draft.iban,
            });
            await this.stampPostLoginTarget(
                ctx.userId,
                business.slug,
                account.slug
            );
            return {
                claimState: 'success',
                claimedBusinessSlug: business.slug,
                claimedAccountSlug: account.slug,
            };
        } catch (err) {
            // Sprint 10 review fix — POST2-replay safety-net на retry після
            // lost-response. Сценарій: попередній attempt успішно створив
            // Business B1 + Account A1, але response не дійшов до клієнта
            // (закрита вкладка / network drop); persisted claimIdempotencyKey
            // тригерить retry → POST1 replay через BusinessesService.create
            // dedup повертає той самий B1 → POST2 падає на `(businessId,iban)`
            // unique-index із 409 ACCOUNT_IBAN_DUPLICATE.
            //
            // Без цього replay frontend пішов би на /account/new?from=landing,
            // де submit з тим самим IBAN-ом знову б упав із 409 → infinite
            // recovery loop. Тому lookup існуючий account і повертаємо success
            // з resolved slug — UX-level idempotency для POST2-step.
            //
            // **Замикання тільки тут**, а не у AccountsService.create:
            // cabinet-edit для свого IBAN-collision-у потребує саме 409 з UA-
            // повідомленням "IBAN вже доданий"; idempotency-context (той самий
            // claim-attempt, не випадковий збіг IBAN-у) живе тільки тут —
            // claimIdempotencyKey гарантує "це той самий claim", чого
            // AccountsService.create не знає.
            if (
                err instanceof HttpException &&
                isAccountIbanDuplicate(err)
            ) {
                const existing =
                    await this.accountsService.findByBusinessAndIban(
                        business._id,
                        draft.iban
                    );
                if (existing) {
                    await this.stampPostLoginTarget(
                        ctx.userId,
                        business.slug,
                        existing.slug
                    );
                    return {
                        claimState: 'success',
                        claimedBusinessSlug: business.slug,
                        claimedAccountSlug: existing.slug,
                    };
                }
            }

            this.logClaimFailure('POST2', ctx.userId, err, {
                business: business.slug,
            });
            return {
                claimState: 'account-failed',
                partialBusinessSlug: business.slug,
                failedClaimDraft: draft,
            };
        }
    }

    /**
     * Sprint 10 review fix — диференціація log-level-у для observability.
     * HttpException з status ≥ 500 (`SLUG_GENERATION_FAILED`,
     * `TRANSACTION_REQUIRES_REPLICA_SET`) або не-HttpException (raw Error —
     * Mongo connection drop, unexpected) → `logger.error`, бо infrastructure-
     * issue, alertable. 4xx-class HttpException (`ACCOUNT_IBAN_DUPLICATE`,
     * validation, `TAX_ID_FORMAT_MISMATCH_TYPE`) → `logger.warn`, бо user-
     * actionable і recovery-flow обробляє його через frontend redirect на
     * /business/new?from=landing або /account/new?from=landing.
     *
     * До цього розрізнення production-incident "replica-set missing" гаснув у
     * warn-стрім разом з legitимним IBAN-duplicate; alerting не міг розрізнити.
     */
    private logClaimFailure(
        stage: 'POST1' | 'POST2',
        userId: string,
        err: unknown,
        extra?: Record<string, string>
    ): void {
        const message = err instanceof Error ? err.message : String(err);
        const extraStr = extra
            ? ' ' +
              Object.entries(extra)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(' ')
            : '';
        const ctx = `LandingClaim ${stage} failed for user ${userId}${extraStr}: ${message}`;
        // Невідомий error (не-HttpException) трактуємо як infra-issue: lower
        // services (Businesses/Accounts) типово мапять відомі помилки у
        // HttpException; raw Error означає uncaught surprise.
        const status =
            err instanceof HttpException ? err.getStatus() : 500;
        if (status >= 500) {
            this.logger.error(ctx);
        } else {
            this.logger.warn(ctx);
        }
    }

    /**
     * Sprint 11 — на success-claim стемпить deep-link для cold-login resume.
     * Stamp non-blocking за дизайном: claim вже виконався, повертаємо success
     * незалежно від результату стемпу. Catch розрізняє severity для alerting:
     *  - `INVALID_REDIRECT_TARGET` — programmer bug у path-template; рідкісне,
     *    але alertable, бо означає що cold-login resume для цього user-а
     *    структурно зламаний → `logger.error`.
     *  - Решта (Mongo timeout, transient infra) → `logger.warn`, бо очікувано
     *    у race-сценаріях і recovery вже покрито Sprint 12 cron-cleanup-flow.
     * Без re-throw: invariant "stamp-failure не блокує claim-flow".
     */
    private async stampPostLoginTarget(
        userId: string,
        businessSlug: string,
        accountSlug: string
    ): Promise<void> {
        const target = `/business/${businessSlug}/account/${accountSlug}?completed-from=landing`;
        try {
            await this.usersService.setPendingPostLoginTarget(userId, target);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const ctx = `Failed to stamp pendingPostLoginTarget for user ${userId} → ${target}: ${message}`;
            if (isInvalidRedirectTarget(err)) {
                this.logger.error(ctx);
            } else {
                this.logger.warn(ctx);
            }
        }
    }
}

function isAccountIbanDuplicate(err: HttpException): boolean {
    const resp = err.getResponse();
    return (
        typeof resp === 'object' &&
        resp !== null &&
        'code' in resp &&
        (resp as { code: unknown }).code ===
            RESPONSE_CODE.ACCOUNT_IBAN_DUPLICATE
    );
}

function isInvalidRedirectTarget(err: unknown): boolean {
    if (!(err instanceof HttpException)) return false;
    const resp = err.getResponse();
    return (
        typeof resp === 'object' &&
        resp !== null &&
        'code' in resp &&
        (resp as { code: unknown }).code ===
            RESPONSE_CODE.INVALID_REDIRECT_TARGET
    );
}
