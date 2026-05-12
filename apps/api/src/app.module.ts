import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OnboardingInterceptor } from './common/interceptors/onboarding.interceptor';
import { ENV } from './config/env';
import { RedisModule } from './common/modules/redis.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AuthModule } from './modules/auth/auth.module';
import { BusinessesModule } from './modules/businesses/businesses.module';
import { EmailModule } from './modules/email/email.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { LandingClaimModule } from './modules/landing-claim/landing-claim.module';
import { UsersModule } from './modules/users/users.module';
import { ReportsModule } from './modules/reports/reports.module';
import { StorageModule } from './modules/storage/storage.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { QrModule } from './modules/qr/qr.module';
import { AiModule } from './modules/ai/ai.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        ThrottlerModule.forRoot({
            // Named throttlers: дефолтний — для cabinet/auth/AI/storage/payments
            // (60 req/min на IP як guard від abuse). Окрема `public-payment`-
            // policy — для public-payment endpoints (`PublicBusinessesController`,
            // `PublicInvoicesController`): за NAT/CDN/Next-server-proxy багато
            // різних клієнтів виглядають для API як один IP, і дефолтний 60/min
            // блокує реальні платежі (сторінка робить >=3 виклики: JSON view +
            // 2 QR PNG; миттєвий шквал 20 клієнтів вичерпує budget). Захист
            // зберігається — limit просто вищий під специфіку зони. Apply через
            // `@Throttle({ 'public-payment': ... })` + `@SkipThrottle({ default:
            // true })` на public-контролерах.
            //
            // Sprint 8 §8.1 — окремий `'qr-preview'` bucket (10/min/IP) для
            // anon `POST /qr/preview`. Restrictive за дизайном: payload-
            // перебір тут потенційно дешевший за full payment-page-hit (нема
            // БД-lookup-у), і легітимний UX (анонім заповнює форму один раз)
            // вкладається в 10/min навіть з NAT-агрегацією. Apply через
            // `@Throttle({ 'qr-preview': ... })` + `@SkipThrottle({ default:
            // true })` на `QrController`.
            throttlers: [
                { name: 'default', ttl: 60000, limit: 60 },
                { name: 'public-payment', ttl: 60000, limit: 600 },
                { name: 'qr-preview', ttl: 60000, limit: 10 },
            ],
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
        ReportsModule,
        StorageModule,
        PaymentsModule,
        QrModule,
        AiModule,
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
