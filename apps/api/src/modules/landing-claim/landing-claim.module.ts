import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { LandingClaimService } from './landing-claim.service';

/**
 * Sprint 10 §10.1 — окремий module для separation of concerns. AuthModule
 * імпортує LandingClaimModule без forwardRef (петлі немає: Auth depends on
 * LandingClaim → Businesses + Accounts, які не знають про Auth).
 *
 * Dependency DAG:
 *   AuthModule → LandingClaimModule → {BusinessesModule, AccountsModule}
 *
 * BusinessesModule + AccountsModule самі імпортують UsersModule (для access-
 * patterns); UsersModule forwardRef-ить AuthModule. Кільце замикається через
 * forwardRef, не через цей модуль.
 */
@Module({
    imports: [BusinessesModule, AccountsModule],
    providers: [LandingClaimService],
    exports: [LandingClaimService],
})
export class LandingClaimModule {}
