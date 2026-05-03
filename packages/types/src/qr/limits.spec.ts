import {
    FIELD_LIMITS,
    PAYLOAD_BASE64URL_BYTE_LIMIT,
    PAYLOAD_OVERALL_BYTE_LIMIT,
    assertWithinUtf8Limits,
    effectiveLimit,
} from './limits';

describe('FIELD_LIMITS — snapshot нормативу', () => {
    it('002: receiverName 140C / 280B, purpose 420C / 840B', () => {
        expect(FIELD_LIMITS['002'].receiverName).toEqual({
            chars: 140,
            bytes: 280,
        });
        expect(FIELD_LIMITS['002'].purpose).toEqual({
            chars: 420,
            bytes: 840,
        });
    });

    it('003: спільні з 002 + 003-only поля', () => {
        expect(FIELD_LIMITS['003'].receiverName).toEqual({
            chars: 140,
            bytes: 280,
        });
        expect(FIELD_LIMITS['003'].purpose).toEqual({
            chars: 420,
            bytes: 840,
        });
        expect(FIELD_LIMITS['003'].categoryPurpose).toEqual({
            chars: 9,
            bytes: 9,
        });
        expect(FIELD_LIMITS['003'].reference).toEqual({
            chars: 35,
            bytes: 35,
        });
        expect(FIELD_LIMITS['003'].display).toEqual({
            chars: 140,
            bytes: 280,
        });
    });
});

describe('PAYLOAD_*_BYTE_LIMIT — snapshot нормативу', () => {
    it('загальний обсяг payload ≤ 507 B (Додатки 3 §IV.11, 4 §IV.8)', () => {
        expect(PAYLOAD_OVERALL_BYTE_LIMIT).toBe(507);
    });

    it('Base64URL frame ≤ 475 B (таблиця 1 у обох Додатках)', () => {
        expect(PAYLOAD_BASE64URL_BYTE_LIMIT).toBe(475);
    });
});

describe('assertWithinUtf8Limits', () => {
    it('приймає рядок у межах chars і bytes', () => {
        const result = assertWithinUtf8Limits('hello', {
            chars: 10,
            bytes: 10,
        });
        expect(result).toEqual({ ok: true });
    });

    it('відхиляє при overflow chars (ASCII)', () => {
        const result = assertWithinUtf8Limits('abcdefghijk', {
            chars: 10,
            bytes: 100,
        });
        expect(result).toEqual({
            ok: false,
            reason: 'CHARS',
            actual: 11,
            limit: 10,
        });
    });

    it('відхиляє при overflow bytes (cyrillic-heavy)', () => {
        // 6 cyrillic chars = 12 bytes UTF-8.
        // chars-limit 10 не перевищено, bytes-limit 11 перевищено.
        const result = assertWithinUtf8Limits('Привіт', {
            chars: 10,
            bytes: 11,
        });
        expect(result).toEqual({
            ok: false,
            reason: 'BYTES',
            actual: 12,
            limit: 11,
        });
    });

    it('cyrillic char займає 2 байти UTF-8 (sanity-check counter-у)', () => {
        const result = assertWithinUtf8Limits('І', { chars: 1, bytes: 1 });
        expect(result).toEqual({
            ok: false,
            reason: 'BYTES',
            actual: 2,
            limit: 1,
        });
    });

    it('emoji займає 4 байти UTF-8', () => {
        const result = assertWithinUtf8Limits('☕', { chars: 1, bytes: 2 });
        expect(result.ok).toBe(false);
    });

    it('apostrophe U+2019 (’) займає 3 байти UTF-8 — поширений pitfall у назвах ФОП', () => {
        // Кав’ярня — 1 char але 3 bytes для апострофа.
        const result = assertWithinUtf8Limits('’', { chars: 1, bytes: 2 });
        expect(result).toEqual({
            ok: false,
            reason: 'BYTES',
            actual: 3,
            limit: 2,
        });
    });

    it('порожній рядок завжди валідний', () => {
        const result = assertWithinUtf8Limits('', { chars: 0, bytes: 0 });
        expect(result).toEqual({ ok: true });
    });

    it('exact boundary — chars=N, bytes=N для ASCII', () => {
        const result = assertWithinUtf8Limits('aaaaa', {
            chars: 5,
            bytes: 5,
        });
        expect(result).toEqual({ ok: true });
    });
});

describe('effectiveLimit — MIN по версіях', () => {
    it('receiverName: 002=140 / 003=140 → MIN=140', () => {
        expect(effectiveLimit('receiverName')).toEqual({
            chars: 140,
            bytes: 280,
        });
    });

    it('purpose: 002=420 / 003=420 → MIN=420', () => {
        expect(effectiveLimit('purpose')).toEqual({
            chars: 420,
            bytes: 840,
        });
    });

    // TS прибирає неспільні поля (categoryPurpose, reference, display) ще на
    // compile-time через `keyof CommonFields`. Якщо хтось додасть поле, що є
    // тільки в одній версії, ця функція його не повертає — це навмисно.
    it('TS-обмеження: лише спільні поля (compile-time check, runtime no-op)', () => {
        // Огорнуто в декларацію без виклику: ts-expect-error працює compile-time,
        // runtime ніколи не викликає замикання, тож reading undefined у Math.min не виникає.
        const compileTimeCheck = (): unknown => {
            // @ts-expect-error — categoryPurpose є тільки у 003
            return effectiveLimit('categoryPurpose');
        };
        expect(typeof compileTimeCheck).toBe('function');
    });
});
