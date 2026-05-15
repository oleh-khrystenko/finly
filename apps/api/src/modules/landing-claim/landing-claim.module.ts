import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { AuthModule } from '../auth/auth.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { UsersModule } from '../users/users.module';
import { LandingClaimService } from './landing-claim.service';
import { MagicLinkVerifyController } from './magic-link-verify.controller';

/**
 * Sprint 10 §10.1 — окремий module для separation of concerns.
 *
 * Sprint 13 §13 — інверсія module-graph: LandingClaimModule стало резидентом
 * `MagicLinkVerifyController` (раніше живив у AuthModule). AuthModule вже НЕ
 * імпортує LandingClaimModule — натомість LandingClaim імпортує AuthModule
 * для доступу до `AuthService` всередині свого orchestration-controller-а.
 *
 * Це розриває CJS-evaluation ланцюг `accounts → businesses → users → auth →
 * landing-claim → businesses`, у якому `auth.module.ts` починало evaluate
 * `landing-claim.module.ts` до завершення CJS-evaluation `businesses.module.ts`
 * (і отримувало `BusinessesModule = undefined` у `imports[0]`).
 *
 * Dependency DAG:
 *   LandingClaimModule → {BusinessesModule, AccountsModule, UsersModule, AuthModule}
 *   AuthModule       → {UsersModule (forwardRef)}  (НЕ → LandingClaimModule)
 */
@Module({
    imports: [BusinessesModule, AccountsModule, UsersModule, AuthModule],
    controllers: [MagicLinkVerifyController],
    providers: [LandingClaimService],
    exports: [LandingClaimService],
})
export class LandingClaimModule {}
