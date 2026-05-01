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
import { AuthModule } from './modules/auth/auth.module';
import { BusinessesModule } from './modules/businesses/businesses.module';
import { EmailModule } from './modules/email/email.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { UsersModule } from './modules/users/users.module';
import { ReportsModule } from './modules/reports/reports.module';
import { StorageModule } from './modules/storage/storage.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AiModule } from './modules/ai/ai.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        ThrottlerModule.forRoot({
            throttlers: [{ ttl: 60000, limit: 60 }],
        }),
        ScheduleModule.forRoot(),
        MongooseModule.forRoot(ENV.MONGODB_URI),
        RedisModule,
        AuthModule,
        EmailModule,
        UsersModule,
        BusinessesModule,
        InvoicesModule,
        ReportsModule,
        StorageModule,
        PaymentsModule,
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
