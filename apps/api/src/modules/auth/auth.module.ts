import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { ENV } from '../../config/env';
import { LandingClaimModule } from '../landing-claim/landing-claim.module';
import { UsersModule } from '../users/users.module';
import { StorageModule } from '../storage/storage.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
    imports: [
        PassportModule,
        JwtModule.register({
            secret: ENV.JWT_ACCESS_SECRET,
            signOptions: { expiresIn: '1h' },
        }),
        forwardRef(() => UsersModule),
        StorageModule,
        // Sprint 10 §10.1 — без forwardRef (петлі немає: LandingClaim →
        // Businesses/Accounts, які не імпортують AuthModule напряму).
        LandingClaimModule,
    ],
    controllers: [AuthController],
    providers: [AuthService, JwtStrategy, GoogleStrategy],
    exports: [AuthService],
})
export class AuthModule {}
