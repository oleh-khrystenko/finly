import { validateOrphanCleanupSchedule } from './env';

describe('validateOrphanCleanupSchedule (Sprint 12 §12.1a)', () => {
    it('passes on default schedule 1 < 6 < 7', () => {
        expect(() => validateOrphanCleanupSchedule(1, 6, 7)).not.toThrow();
    });

    it('passes on aggressive but valid 1 < 2 < 3 schedule', () => {
        expect(() => validateOrphanCleanupSchedule(1, 2, 3)).not.toThrow();
    });

    it('rejects firstDays === 0 (zero grace breaks UX-invariant)', () => {
        expect(() => validateOrphanCleanupSchedule(0, 6, 7)).toThrow(
            /ORPHAN_REMINDER_FIRST_DAYS must be an integer ≥ 1/
        );
    });

    it('rejects negative firstDays', () => {
        expect(() => validateOrphanCleanupSchedule(-1, 6, 7)).toThrow(
            /ORPHAN_REMINDER_FIRST_DAYS must be an integer ≥ 1/
        );
    });

    it('rejects non-integer firstDays', () => {
        expect(() => validateOrphanCleanupSchedule(1.5, 6, 7)).toThrow(
            /ORPHAN_REMINDER_FIRST_DAYS must be an integer ≥ 1/
        );
    });

    it('rejects non-integer finalDays', () => {
        expect(() => validateOrphanCleanupSchedule(1, 6.5, 7)).toThrow(
            /must be integers/
        );
    });

    it('rejects first === final (stages overlap)', () => {
        expect(() => validateOrphanCleanupSchedule(2, 2, 7)).toThrow(
            /schedule must satisfy/
        );
    });

    it('rejects final === deletion (stages overlap)', () => {
        expect(() => validateOrphanCleanupSchedule(1, 7, 7)).toThrow(
            /schedule must satisfy/
        );
    });

    it('rejects inverted order first > final', () => {
        expect(() => validateOrphanCleanupSchedule(6, 1, 7)).toThrow(
            /schedule must satisfy/
        );
    });

    it('rejects inverted order final > deletion', () => {
        expect(() => validateOrphanCleanupSchedule(1, 8, 7)).toThrow(
            /schedule must satisfy/
        );
    });

    it('rejects degenerate all-equal (default-like fallback collapse)', () => {
        expect(() => validateOrphanCleanupSchedule(2, 2, 2)).toThrow(
            /schedule must satisfy/
        );
    });
});
