import { NestFactory } from '@nestjs/core';
import * as cookieParser from 'cookie-parser';
import { ZodValidationPipe } from 'nestjs-zod';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppModule } from './app.module';
import { ENV } from './config/env';

async function bootstrap() {
    const isProduction = ENV.NODE_ENV === 'production';

    const app = await NestFactory.create(AppModule, {
        rawBody: true,
        logger: isProduction
            ? ['error', 'warn', 'log']
            : ['error', 'warn', 'log', 'debug', 'verbose'],
    });

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
