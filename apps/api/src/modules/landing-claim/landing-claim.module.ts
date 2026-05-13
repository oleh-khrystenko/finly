import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { UsersModule } from '../users/users.module';
import { LandingClaimService } from './landing-claim.service';

/**
 * Sprint 10 §10.1 — окремий module для separation of concerns. AuthModule
 * імпортує LandingClaimModule без forwardRef (петлі немає: Auth depends on
 * LandingClaim → Businesses + Accounts, які не знають про Auth).
 *
 * Sprint 11 — додано UsersModule для виклику `setPendingPostLoginTarget`
 * напряму на success-claim. Граф залишається directed-acyclic: UsersModule
 * forwardRef-ить лише AuthModule (existing), а не LandingClaim.
 *
 * Dependency DAG:
 *   AuthModule → LandingClaimModule → {BusinessesModule, AccountsModule, UsersModule}
 */
@Module({
    imports: [BusinessesModule, AccountsModule, UsersModule],
    providers: [LandingClaimService],
    exports: [LandingClaimService],
})
export class LandingClaimModule {}
