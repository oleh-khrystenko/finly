import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { THROTTLERS } from './common/http/throttle-policy';
import { OnboardingInterceptor } from './common/interceptors/onboarding.interceptor';
import { ENV } from './config/env';
import { RedisModule } from './common/modules/redis.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AdminPayeesModule } from './modules/admin-payees/admin-payees.module';
import { AuthModule } from './modules/auth/auth.module';
import { BusinessesModule } from './modules/businesses/businesses.module';
import { EmailModule } from './modules/email/email.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { LandingClaimModule } from './modules/landing-claim/landing-claim.module';
import { OrphanCleanupModule } from './modules/orphan-cleanup/orphan-cleanup.module';
import { UsersModule } from './modules/users/users.module';
import { ReportsModule } from './modules/reports/reports.module';
import { StorageModule } from './modules/storage/storage.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { QrModule } from './modules/qr/qr.module';
import { AiModule } from './modules/ai/ai.module';
import { GuidesModule } from './modules/guides/guides.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        // Реєстр named-throttler-ів (імена, ліміти і призначення кожного бакета)
        // живе у `common/http/throttle-policy.ts` разом зі `skipThrottlersExcept`:
        // guard проганяє кожен бакет на кожному роуті, тож скіп-мапу треба рахувати
        // від повного списку, інакше новий бакет тихо затінює наявні роути.
        ThrottlerModule.forRoot({
            throttlers: [...THROTTLERS],
        }),
        ScheduleModule.forRoot(),
        MongooseModule.forRoot(ENV.MONGODB_URI),
        RedisModule,
        AuthModule,
        EmailModule,
        UsersModule,
        BusinessesModule,
        AccountsModule,
        InvoicesModule,
        LandingClaimModule,
        OrphanCleanupModule,
        ReportsModule,
        StorageModule,
        PaymentsModule,
        QrModule,
        AiModule,
        GuidesModule,
        AdminPayeesModule,
    ],
    controllers: [AppController],
    providers: [
        AppService,
        {
            provide: APP_GUARD,
            useClass: ThrottlerGuard,
        },
        {
            provide: APP_INTERCEPTOR,
            useClass: OnboardingInterceptor,
        },
    ],
})
export class AppModule {}
