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
import { EmailModule } from './modules/email/email.module';
import { UsersModule } from './modules/users/users.module';
import { ReportsModule } from './modules/reports/reports.module';
import { StorageModule } from './modules/storage/storage.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AgencyModule } from './modules/agency/agency.module';
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
        ReportsModule,
        StorageModule,
        PaymentsModule,
        AgencyModule,
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
