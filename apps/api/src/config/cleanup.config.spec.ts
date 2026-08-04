import {
    BRAND_CLEANUP,
    ORPHAN_CLEANUP,
    validateBrandCleanupThresholds,
    validateOrphanCleanupSchedule,
} from './cleanup.config';

describe('validateOrphanCleanupSchedule', () => {
    it('passes on the shipped schedule', () => {
        expect(() =>
            validateOrphanCleanupSchedule(
                ORPHAN_CLEANUP.firstReminderDays,
                ORPHAN_CLEANUP.finalReminderDays,
                ORPHAN_CLEANUP.deletionDays
            )
        ).not.toThrow();
    });

    it('passes on aggressive but valid 1 < 2 < 3 schedule', () => {
        expect(() => validateOrphanCleanupSchedule(1, 2, 3)).not.toThrow();
    });

    it('rejects firstDays === 0 (zero grace breaks UX-invariant)', () => {
        expect(() => validateOrphanCleanupSchedule(0, 6, 7)).toThrow(
            /firstReminderDays must be an integer ≥ 1/
        );
    });

    it('rejects negative firstDays', () => {
        expect(() => validateOrphanCleanupSchedule(-1, 6, 7)).toThrow(
            /firstReminderDays must be an integer ≥ 1/
        );
    });

    it('rejects non-integer firstDays', () => {
        expect(() => validateOrphanCleanupSchedule(1.5, 6, 7)).toThrow(
            /firstReminderDays must be an integer ≥ 1/
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

    it('rejects degenerate all-equal', () => {
        expect(() => validateOrphanCleanupSchedule(2, 2, 2)).toThrow(
            /schedule must satisfy/
        );
    });
});

describe('validateBrandCleanupThresholds', () => {
    it('passes on the shipped thresholds', () => {
        expect(() =>
            validateBrandCleanupThresholds(
                BRAND_CLEANUP.pendingDays,
                BRAND_CLEANUP.demotedDays
            )
        ).not.toThrow();
    });

    it('passes when pending === demoted (boundary)', () => {
        expect(() => validateBrandCleanupThresholds(30, 30)).not.toThrow();
    });

    it('rejects inverted pending > demoted', () => {
        expect(() => validateBrandCleanupThresholds(90, 30)).toThrow(
            /pendingDays/
        );
    });
});
