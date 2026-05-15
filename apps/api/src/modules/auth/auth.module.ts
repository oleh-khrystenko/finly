import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { ENV } from '../../config/env';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';

/**
 * Sprint 13 §13 — AuthModule більше НЕ імпортує LandingClaimModule.
 * `verifyMagicLink` orchestration переїхала у власний controller-резидент
 * LandingClaimModule (`MagicLinkVerifyController`). Це інверсія на рівні
 * module-graph, не лише класового знання: завдяки їй CJS-evaluation ланцюг
 * `accounts → businesses → users → auth → landing-claim → businesses` більше
 * не замикається — `auth.module.ts` завершує evaluation без імпорту
 * `landing-claim.module.ts`, тому LandingClaim CJS-evaluating стартує лише
 * коли businesses/accounts/users/auth уже фіналізовані.
 *
 * Залишковий справжній bidirectional cycle Auth ↔ Users (видалення акаунта
 * потребує revoke токенів) тримається на двох `forwardRef` і не порушує
 * CJS-evaluation, бо forwardRef функцію не викликає на decoration-time.
 */
@Module({
    imports: [
        PassportModule,
        JwtModule.register({
            secret: ENV.JWT_ACCESS_SECRET,
            signOptions: { expiresIn: '1h' },
        }),
        forwardRef(() => UsersModule),
    ],
    controllers: [AuthController],
    providers: [AuthService, JwtStrategy, GoogleStrategy],
    exports: [AuthService],
})
export class AuthModule {}
