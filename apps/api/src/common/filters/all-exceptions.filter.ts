import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Response } from 'express';
import {
    PayloadValidationError,
    RESPONSE_CODE,
    type PayloadErrorCode,
    type ResponseCode,
} from '@finly/types';

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
    // Sprint 29 — маркери підстановки у призначенні. Доменні coupled-rule-и
    // (маркер легальний лише у системного отримувача), не field-format, тож
    // піднімаємо у власний response-code: інакше адмін бачив би generic
    // VALIDATION_ERROR замість пояснення, що саме не так із шаблоном.
    // Обидва refine живуть і на Business.paymentPurposeTemplate, і на
    // Account.paymentPurposeTemplate (per-account override, Sprint 29).
    PURPOSE_MARKERS_NOT_ALLOWED: RESPONSE_CODE.PURPOSE_MARKERS_NOT_ALLOWED,
    PURPOSE_MARKER_UNKNOWN: RESPONSE_CODE.PURPOSE_MARKER_UNKNOWN,
};

/**
 * Sprint 8 fix — `PayloadValidationError` (доменна помилка QR-builder-а)
 * → HTTP response. До Sprint 8 ця помилка просочувалася через generic
 * 500 INTERNAL_ERROR (бо клас не extends `HttpException`), що виглядало
 * як backend bug на легітимний user input — наприклад, `purpose='А'.repeat(420)`
 * (валідні 420 cyrillic chars per-field, але payload 840 B перевищує
 * норматив 507 B; emergent property комбінації полів, не окремого поля).
 *
 * **Розгалуження за `PayloadErrorCode`:**
 *  - **Overall-size overflow** (`PAYLOAD_OVERALL_SIZE_EXCEEDED`,
 *    `PAYLOAD_BASE64URL_SIZE_EXCEEDED`) → 400 + `PAYLOAD_TOO_LARGE`. Це
 *    user-actionable: "скоротіть назву / призначення".
 *  - **Field-format errors** (`PAYLOAD_FIELD_TOO_LONG_*`,
 *    `PAYLOAD_INVALID_FIELD_FORMAT`, `PAYLOAD_INVALID_AMOUNT`,
 *    `PAYLOAD_INVALID_CHARSET`) → 400 + `VALIDATION_ERROR`. Defense-in-depth:
 *    Zod на write-DTO мав би їх зловити раніше, але якщо builder викликається
 *    з input-у, що минув DTO (cabinet-flow з legacy-документа БД), цей шлях
 *    дає чисту 400, не 500.
 *  - **Host-config errors** (`PAYLOAD_HOST_REQUIRED`,
 *    `PAYLOAD_NON_COMPLIANT_HOST`) → 500 + `INTERNAL_ERROR`. Host фіксований
 *    на server-side (`NBU_HOST_PRIMARY` / `NBU_HOST_LEGACY`); ці помилки
 *    означають server-misconfig, не user-input.
 */
const PAYLOAD_ERROR_TO_HTTP: Record<
    PayloadErrorCode,
    { status: HttpStatus; code: ResponseCode }
> = {
    PAYLOAD_OVERALL_SIZE_EXCEEDED: {
        status: HttpStatus.BAD_REQUEST,
        code: RESPONSE_CODE.PAYLOAD_TOO_LARGE,
    },
    PAYLOAD_BASE64URL_SIZE_EXCEEDED: {
        status: HttpStatus.BAD_REQUEST,
        code: RESPONSE_CODE.PAYLOAD_TOO_LARGE,
    },
    PAYLOAD_FIELD_TOO_LONG_CHARS: {
        status: HttpStatus.BAD_REQUEST,
        code: RESPONSE_CODE.VALIDATION_ERROR,
    },
    PAYLOAD_FIELD_TOO_LONG_BYTES: {
        status: HttpStatus.BAD_REQUEST,
        code: RESPONSE_CODE.VALIDATION_ERROR,
    },
    PAYLOAD_INVALID_FIELD_FORMAT: {
        status: HttpStatus.BAD_REQUEST,
        code: RESPONSE_CODE.VALIDATION_ERROR,
    },
    PAYLOAD_INVALID_AMOUNT: {
        status: HttpStatus.BAD_REQUEST,
        code: RESPONSE_CODE.VALIDATION_ERROR,
    },
    PAYLOAD_INVALID_CHARSET: {
        status: HttpStatus.BAD_REQUEST,
        code: RESPONSE_CODE.VALIDATION_ERROR,
    },
    PAYLOAD_HOST_REQUIRED: {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: RESPONSE_CODE.INTERNAL_ERROR,
    },
    PAYLOAD_NON_COMPLIANT_HOST: {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: RESPONSE_CODE.INTERNAL_ERROR,
    },
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

        // Sprint 8 fix — domain-specific QR-builder помилки. Без цього early
        // return `PayloadValidationError` йде через generic 500-шлях, бо клас
        // не extends `HttpException`. Мапимо на 400/500 + machine code за
        // природою помилки (overall-size = user-actionable, host-config =
        // server-misconfig). Логування зберігаємо лише для server-side cases.
        if (exception instanceof PayloadValidationError) {
            const mapping = PAYLOAD_ERROR_TO_HTTP[exception.code];
            // Enum comparison: PAYLOAD_ERROR_TO_HTTP видає лише 400 або 500,
            // тож explicit-check на 500 простіший за числове `>= 500` (яке
            // ESLint `no-unsafe-enum-comparison` блокує для HttpStatus).
            if (mapping.status === HttpStatus.INTERNAL_SERVER_ERROR) {
                this.logger.error(exception.message, exception.stack);
            }
            response.status(mapping.status).json({
                error: {
                    code: mapping.code,
                    message: exception.message,
                },
            });
            return;
        }

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

        // Allow exceptions to carry an explicit error code (e.g. access-level
        // замки на кшталт assertSlugEditAllowed).
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
