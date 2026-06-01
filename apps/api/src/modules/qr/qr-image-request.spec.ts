import { BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { QR_SIZE_PX } from '@finly/types';

import {
    applyQrDownloadDisposition,
    isQrDownloadRequested,
    resolveQrSizePxFromQuery,
} from './qr-image-request';

describe('resolveQrSizePxFromQuery', () => {
    it('без параметра → дефолтний екранний розмір', () => {
        expect(resolveQrSizePxFromQuery(undefined)).toBe(QR_SIZE_PX.screen);
    });

    it('"screen" → екранний px', () => {
        expect(resolveQrSizePxFromQuery('screen')).toBe(QR_SIZE_PX.screen);
    });

    it('"print" → друкарський px', () => {
        expect(resolveQrSizePxFromQuery('print')).toBe(QR_SIZE_PX.print);
    });

    it('довільне число / невідоме значення → 400 VALIDATION_ERROR (захист рендеру)', () => {
        for (const bogus of ['1000', '0', 'huge', 'SCREEN', '']) {
            expect(() => resolveQrSizePxFromQuery(bogus)).toThrow(
                BadRequestException
            );
        }
        try {
            resolveQrSizePxFromQuery('9999');
            fail('expected throw');
        } catch (err) {
            expect(err).toBeInstanceOf(BadRequestException);
            expect((err as BadRequestException).getResponse()).toMatchObject({
                code: 'VALIDATION_ERROR',
            });
        }
    });
});

describe('isQrDownloadRequested', () => {
    it.each([
        ['1', true],
        ['true', true],
        ['0', false],
        ['false', false],
        [undefined, false],
        ['', false],
    ])('"%s" → %s', (param, expected) => {
        expect(isQrDownloadRequested(param)).toBe(expected);
    });
});

describe('applyQrDownloadDisposition', () => {
    function mockRes(): { res: Response; setHeader: jest.Mock } {
        const setHeader = jest.fn();
        return { res: { setHeader } as unknown as Response, setHeader };
    }

    it('download=true → ставить attachment з filename', () => {
        const { res, setHeader } = mockRes();
        applyQrDownloadDisposition(res, true, 'qr-x.png');
        expect(setHeader).toHaveBeenCalledWith(
            'Content-Disposition',
            'attachment; filename="qr-x.png"'
        );
    });

    it('download=false → не ставить заголовок (inline)', () => {
        const { res, setHeader } = mockRes();
        applyQrDownloadDisposition(res, false, 'qr-x.png');
        expect(setHeader).not.toHaveBeenCalled();
    });
});
