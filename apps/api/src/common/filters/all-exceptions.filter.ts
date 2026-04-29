import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { RESPONSE_CODE, type ResponseCode } from '@neatslip/types';

const HTTP_STATUS_TO_ERROR_CODE: Partial<Record<HttpStatus, ResponseCode>> = {
    [HttpStatus.BAD_REQUEST]: RESPONSE_CODE.VALIDATION_ERROR,
    [HttpStatus.UNAUTHORIZED]: RESPONSE_CODE.UNAUTHORIZED,
    [HttpStatus.NOT_FOUND]: RESPONSE_CODE.NOT_FOUND,
    [HttpStatus.UNPROCESSABLE_ENTITY]: RESPONSE_CODE.VALIDATION_ERROR,
    [HttpStatus.TOO_MANY_REQUESTS]: RESPONSE_CODE.RATE_LIMIT_EXCEEDED,
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    private readonly logger = new Logger(AllExceptionsFilter.name);

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();

        const status =
            exception instanceof HttpException
                ? exception.getStatus()
                : HttpStatus.INTERNAL_SERVER_ERROR;

        const exceptionResponse =
            exception instanceof HttpException ? exception.getResponse() : null;

        const message =
            exception instanceof HttpException
                ? exception.message
                : 'Internal server error';

        // Allow exceptions to carry an explicit error code (e.g. SubscriptionGuard)
        const explicitCode =
            exceptionResponse &&
            typeof exceptionResponse === 'object' &&
            'code' in exceptionResponse
                ? (exceptionResponse as { code: string }).code
                : null;

        const code =
            explicitCode ??
            HTTP_STATUS_TO_ERROR_CODE[status as HttpStatus] ??
            RESPONSE_CODE.INTERNAL_ERROR;

        if (status >= 500) {
            this.logger.error(
                message,
                exception instanceof Error ? exception.stack : undefined
            );
        }

        response.status(status).json({
            error: {
                code,
                message,
            },
        });
    }
}
