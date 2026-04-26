import type { FieldError } from 'react-hook-form';
import { getFieldError } from './getFieldError';

const messages = {
    required: 'Field is required',
    too_small: 'Too short',
    too_big: 'Too long',
    invalid_string: 'Invalid format',
};

const makeError = (type: string): FieldError => ({
    type,
    message: '',
});

describe('getFieldError', () => {
    it('returns undefined when no error', () => {
        expect(getFieldError(undefined, messages)).toBeUndefined();
    });

    it('returns too_big message', () => {
        expect(getFieldError(makeError('too_big'), messages)).toBe('Too long');
    });

    it('returns invalid_string message', () => {
        expect(getFieldError(makeError('invalid_string'), messages)).toBe(
            'Invalid format',
        );
    });

    it('returns invalid_format message when mapped', () => {
        const msgs = { ...messages, invalid_format: 'Bad format' };
        expect(getFieldError(makeError('invalid_format'), msgs)).toBe(
            'Bad format',
        );
    });

    it('returns required when too_small and value is empty', () => {
        expect(getFieldError(makeError('too_small'), messages, '')).toBe(
            'Field is required',
        );
    });

    it('returns required when too_small and value is whitespace', () => {
        expect(getFieldError(makeError('too_small'), messages, '   ')).toBe(
            'Field is required',
        );
    });

    it('returns too_small when too_small and value is non-empty', () => {
        expect(getFieldError(makeError('too_small'), messages, 'a')).toBe(
            'Too short',
        );
    });

    it('returns required when too_small and value is undefined', () => {
        expect(getFieldError(makeError('too_small'), messages)).toBe(
            'Field is required',
        );
    });

    it('falls back to required for unknown error types', () => {
        expect(getFieldError(makeError('custom'), messages)).toBe(
            'Field is required',
        );
    });

    it('works without too_small in messages (password-style: only required + too_small)', () => {
        const msgs = { required: 'Enter password', too_small: 'Min 8 chars' };
        expect(getFieldError(makeError('too_small'), msgs, '')).toBe(
            'Enter password',
        );
        expect(getFieldError(makeError('too_small'), msgs, 'short')).toBe(
            'Min 8 chars',
        );
    });
});
