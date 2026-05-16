import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import {
    PayloadValidationError,
    RESPONSE_CODE,
    type PayloadErrorCode,
} from '@finly/types';

import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * Sprint 8 fix — `PayloadValidationError` mapping. До Sprint 8 цей domain-error
 * клас не extends `HttpException`, тому фільтр віддавав generic 500
 * INTERNAL_ERROR на user-input, що проходив DTO але ламав emergent payload-
 * size constraints. Тести нижче фіксують контракт mapping-у per
 * `PayloadErrorCode`-family.
 */
describe('AllExceptionsFilter — PayloadValidationError mapping', () => {
    let filter: AllExceptionsFilter;
    let jsonMock: jest.Mock;
    let statusMock: jest.Mock;
    let host: ArgumentsHost;

    beforeEach(() => {
        filter = new AllExceptionsFilter();
        jsonMock = jest.fn();
        statusMock = jest.fn().mockReturnValue({ json: jsonMock });
        host = {
            switchToHttp: () => ({
                getResponse: () => ({ status: statusMock }),
            }),
        } as unknown as ArgumentsHost;
    });

    describe('user-actionable size overflow → 400 PAYLOAD_TOO_LARGE', () => {
        it.each<PayloadErrorCode>([
            'PAYLOAD_OVERALL_SIZE_EXCEEDED',
            'PAYLOAD_BASE64URL_SIZE_EXCEEDED',
        ])('%s → 400 + PAYLOAD_TOO_LARGE', (code) => {
            const err = new PayloadValidationError(code, 'payload', '003');
            filter.catch(err, host);

            expect(statusMock).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
            expect(jsonMock).toHaveBeenCalledWith({
                error: {
                    code: RESPONSE_CODE.PAYLOAD_TOO_LARGE,
                    message: expect.stringContaining(code),
                },
            });
        });
    });

    describe('field-format errors → 400 VALIDATION_ERROR (defense-in-depth)', () => {
        it.each<PayloadErrorCode>([
            'PAYLOAD_FIELD_TOO_LONG_CHARS',
            'PAYLOAD_FIELD_TOO_LONG_BYTES',
            'PAYLOAD_INVALID_FIELD_FORMAT',
            'PAYLOAD_INVALID_AMOUNT',
            'PAYLOAD_INVALID_CHARSET',
        ])('%s → 400 + VALIDATION_ERROR', (code) => {
            const err = new PayloadValidationError(code, 'receiverName', '003');
            filter.catch(err, host);

            expect(statusMock).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
            expect(jsonMock).toHaveBeenCalledWith({
                error: {
                    code: RESPONSE_CODE.VALIDATION_ERROR,
                    message: expect.any(String),
                },
            });
        });
    });

    describe('host-config errors → 500 INTERNAL_ERROR (server-misconfig, не user-input)', () => {
        it.each<PayloadErrorCode>([
            'PAYLOAD_HOST_REQUIRED',
            'PAYLOAD_NON_COMPLIANT_HOST',
        ])('%s → 500 + INTERNAL_ERROR', (code) => {
            const err = new PayloadValidationError(code, 'host', '003');
            filter.catch(err, host);

            expect(statusMock).toHaveBeenCalledWith(
                HttpStatus.INTERNAL_SERVER_ERROR
            );
            expect(jsonMock).toHaveBeenCalledWith({
                error: {
                    code: RESPONSE_CODE.INTERNAL_ERROR,
                    message: expect.any(String),
                },
            });
        });
    });

    describe('non-PayloadValidationError fall-through (regression guard)', () => {
        it('звичайний HttpException продовжує працювати через основний flow', () => {
            const err = new BadRequestException({
                code: RESPONSE_CODE.VALIDATION_ERROR,
                message: 'Bad input',
            });
            filter.catch(err, host);

            expect(statusMock).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
            expect(jsonMock).toHaveBeenCalledWith({
                error: {
                    code: RESPONSE_CODE.VALIDATION_ERROR,
                    message: expect.any(String),
                },
            });
        });

        it('звичайна Error → 500 INTERNAL_ERROR (старий шлях)', () => {
            const err = new Error('boom');
            filter.catch(err, host);

            expect(statusMock).toHaveBeenCalledWith(
                HttpStatus.INTERNAL_SERVER_ERROR
            );
            expect(jsonMock).toHaveBeenCalledWith({
                error: {
                    code: RESPONSE_CODE.INTERNAL_ERROR,
                    message: expect.any(String),
                },
            });
        });
    });
});
