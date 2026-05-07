import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { RESPONSE_CODE, type ResponseCode } from '@finly/types';

const HTTP_STATUS_TO_ERROR_CODE: Partial<Record<HttpStatus, ResponseCode>> = {
    [HttpStatus.BAD_REQUEST]: RESPONSE_CODE.VALIDATION_ERROR,
    [HttpStatus.UNAUTHORIZED]: RESPONSE_CODE.UNAUTHORIZED,
    [HttpStatus.NOT_FOUND]: RESPONSE_CODE.NOT_FOUND,
    [HttpStatus.UNPROCESSABLE_ENTITY]: RESPONSE_CODE.VALIDATION_ERROR,
    [HttpStatus.TOO_MANY_REQUESTS]: RESPONSE_CODE.RATE_LIMIT_EXCEEDED,
};

/**
 * Sprint 4 review fix — Zod refine messages → доменні response codes.
 *
 * **Чому окремий map.** Zod refines у `@finly/types/contracts/*` ставлять
 * SCREAMING_SNAKE-код у `message` (наприклад `'AMOUNT_LOCKED_REQUIRES_AMOUNT'`).
 * Frontend `mapValidationCode` мапить це у UA-рядок для inline-помилки поля.
 * Але для **доменних coupled-rule-ів** (не просто field-format) ми хочемо ще
 * й `INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT` response-code, щоб toast/snackbar
 * знав, що це саме invoice-domain помилка, а не generic VALIDATION_ERROR.
 *
 * Без цього мапу: ZodValidationPipe → BadRequestException з Zod-issues
 * масивом, фільтр падав у `HTTP_STATUS_TO_ERROR_CODE[400]` = `VALIDATION_ERROR`,
 * і `INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT` спрацьовував лише для PATCH-flow,
 * де передавали тільки `amountLocked` (Zod refine `data.amount === undefined`
 * пропускає, service-layer `$expr`-filter ловить і кидає explicit code).
 *
 * **Розширення.** Лише доменні coupled-rule-и заносимо сюди — field-format
 * codes (`INVALID_AMOUNT_OVERFLOW`, `INVALID_PURPOSE_BYTE_LENGTH`, …) лишаються
 * generic VALIDATION_ERROR, бо frontend їх вже отримує per-field через
 * `mapValidationCode` (Zod-issues array проходить нижче й окремо).
 */
const ZOD_ISSUE_CODE_TO_RESPONSE_CODE: Record<string, ResponseCode> = {
    AMOUNT_LOCKED_REQUIRES_AMOUNT:
        RESPONSE_CODE.INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT,
};

/**
 * Витягує перший Zod-issue-code з `BadRequestException`-response-у. Контракт
 * `nestjs-zod` `ZodValidationException`: `{ statusCode, message, errors: [{
 *   message, path, code }, …] }`. Беремо `errors[0].message` — це SCREAMING_SNAKE-
 * код, поставлений refine-ом у схемі.
 */
function extractZodIssueCode(resp: unknown): string | null {
    if (!resp || typeof resp !== 'object') return null;
    const errors = (resp as { errors?: unknown }).errors;
    if (!Array.isArray(errors) || errors.length === 0) return null;
    const first = errors[0] as { message?: unknown };
    return typeof first?.message === 'string' ? first.message : null;
}

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

        // Allow exceptions to carry an explicit error code (e.g. SubscriptionGuard).
        const explicitCode =
            exceptionResponse &&
            typeof exceptionResponse === 'object' &&
            'code' in exceptionResponse
                ? (exceptionResponse as { code: string }).code
                : null;

        // Sprint 4 review fix — мапимо domain-coupled Zod-issue-code на
        // response-code, щоб AMOUNT_LOCKED_REQUIRES_AMOUNT не губився як
        // generic VALIDATION_ERROR на CreateInvoice (де refine спрацьовує
        // ДО service.create).
        const zodMappedCode = (() => {
            const issueCode = extractZodIssueCode(exceptionResponse);
            return issueCode
                ? (ZOD_ISSUE_CODE_TO_RESPONSE_CODE[issueCode] ?? null)
                : null;
        })();

        const code =
            explicitCode ??
            zodMappedCode ??
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
