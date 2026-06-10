import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as cookieParser from 'cookie-parser';
import { ZodValidationPipe } from 'nestjs-zod';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppModule } from './app.module';
import { ENV } from './config/env';

async function bootstrap() {
    const isProduction = ENV.NODE_ENV === 'production';

    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        rawBody: true,
        logger: isProduction
            ? ['error', 'warn', 'log']
            : ['error', 'warn', 'log', 'debug', 'verbose'],
    });

    // `request.ip` для per-IP rate-limit-ів (help-chat guard, throttler):
    // довіряємо X-Forwarded-For рівно на TRUST_PROXY_HOPS hop-ів (0 = напряму,
    // заголовок ігнорується). Див. коментар у config/env.ts.
    app.set('trust proxy', ENV.TRUST_PROXY_HOPS);

    app.use(cookieParser());

    app.setGlobalPrefix('api');

    app.enableCors({
        origin: ENV.WEB_URL,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
    });

    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());

    await app.listen(ENV.PORT, '0.0.0.0');
}
void bootstrap();
