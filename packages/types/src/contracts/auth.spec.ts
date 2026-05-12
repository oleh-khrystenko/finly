import { AuthResponseSchema, SendMagicLinkSchema } from './auth';

const VALID_IBAN = 'UA213223130000026007233566001';
const VALID_RNOKPP = '1234567899';
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

const VALID_DRAFT = {
    receiverName: 'Іваненко Олена Петрівна',
    iban: VALID_IBAN,
    taxId: VALID_RNOKPP,
    purpose: 'Поповнення рахунку',
};

const VALID_USER = {
    id: '507f1f77bcf86cd799439011',
    email: 'ivan@example.com',
    role: 'user',
    worksAsBookkeeper: false,
    profile: {
        firstName: 'Іван',
        lastName: 'Петренко',
    },
    executions: {
        balance: 0,
        freeReportUsed: false,
    },
    hasPassword: true,
    deletedAt: null,
    accountDeletionRequestedAt: null,
    billing: null,
    termsVersion: '1.0',
};

describe('SendMagicLinkSchema — Sprint 10 sibling-fields', () => {
    it('accepts baseline payload без claim-fields (backwards-compat)', () => {
        const result = SendMagicLinkSchema.safeParse({
            email: 'ivan@example.com',
        });
        expect(result.success).toBe(true);
    });

    it('accepts payload з усіма 3 sibling-fields (anon-claim flow)', () => {
        const result = SendMagicLinkSchema.safeParse({
            email: 'ivan@example.com',
            purpose: 'register',
            landingDraft: VALID_DRAFT,
            claimIdempotencyKey: VALID_UUID,
            termsVersion: '1.0',
        });
        expect(result.success).toBe(true);
    });

    it('accepts payload з тільки termsVersion (login без claim)', () => {
        const result = SendMagicLinkSchema.safeParse({
            email: 'ivan@example.com',
            purpose: 'login',
            termsVersion: '1.0',
        });
        expect(result.success).toBe(true);
    });

    it('rejects landingDraft без claimIdempotencyKey → LANDING_DRAFT_AND_KEY_MUST_COEXIST', () => {
        const result = SendMagicLinkSchema.safeParse({
            email: 'ivan@example.com',
            landingDraft: VALID_DRAFT,
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some(
                    (i) => i.message === 'LANDING_DRAFT_AND_KEY_MUST_COEXIST'
                )
            ).toBe(true);
        }
    });

    it('rejects claimIdempotencyKey без landingDraft → LANDING_DRAFT_AND_KEY_MUST_COEXIST', () => {
        const result = SendMagicLinkSchema.safeParse({
            email: 'ivan@example.com',
            claimIdempotencyKey: VALID_UUID,
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some(
                    (i) => i.message === 'LANDING_DRAFT_AND_KEY_MUST_COEXIST'
                )
            ).toBe(true);
        }
    });

    it('rejects невалідний UUID format у claimIdempotencyKey', () => {
        const result = SendMagicLinkSchema.safeParse({
            email: 'ivan@example.com',
            landingDraft: VALID_DRAFT,
            claimIdempotencyKey: 'not-a-uuid',
        });
        expect(result.success).toBe(false);
    });

    it('rejects невалідний landingDraft (broken IBAN) через field-level validation', () => {
        const result = SendMagicLinkSchema.safeParse({
            email: 'ivan@example.com',
            landingDraft: {
                ...VALID_DRAFT,
                iban: 'UA000000000000000000000000000',
            },
            claimIdempotencyKey: VALID_UUID,
        });
        expect(result.success).toBe(false);
    });
});

describe('AuthResponseSchema — Sprint 10 claim-fields', () => {
    const BASE_RESPONSE = {
        user: VALID_USER,
        accessToken: 'jwt.access.token',
    };

    it('parses baseline response без claim-fields (backwards-compat)', () => {
        const result = AuthResponseSchema.safeParse(BASE_RESPONSE);
        expect(result.success).toBe(true);
    });

    it('parses claimState=success з slugs', () => {
        const result = AuthResponseSchema.safeParse({
            ...BASE_RESPONSE,
            claimState: 'success',
            claimedBusinessSlug: 'aB3xQ9k7',
            claimedAccountSlug: 'cD4yR0l8',
        });
        expect(result.success).toBe(true);
    });

    it('parses claimState=business-failed з failedClaimDraft', () => {
        const result = AuthResponseSchema.safeParse({
            ...BASE_RESPONSE,
            claimState: 'business-failed',
            failedClaimDraft: VALID_DRAFT,
        });
        expect(result.success).toBe(true);
    });

    it('parses claimState=account-failed з partialBusinessSlug + draft', () => {
        const result = AuthResponseSchema.safeParse({
            ...BASE_RESPONSE,
            claimState: 'account-failed',
            partialBusinessSlug: 'aB3xQ9k7',
            failedClaimDraft: VALID_DRAFT,
        });
        expect(result.success).toBe(true);
    });

    it('rejects claimState=success без claimedBusinessSlug → CLAIM_STATE_FIELDS_MISMATCH', () => {
        const result = AuthResponseSchema.safeParse({
            ...BASE_RESPONSE,
            claimState: 'success',
            claimedAccountSlug: 'cD4yR0l8',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some(
                    (i) => i.message === 'CLAIM_STATE_FIELDS_MISMATCH'
                )
            ).toBe(true);
        }
    });

    it('rejects claimState=success без claimedAccountSlug', () => {
        const result = AuthResponseSchema.safeParse({
            ...BASE_RESPONSE,
            claimState: 'success',
            claimedBusinessSlug: 'aB3xQ9k7',
        });
        expect(result.success).toBe(false);
    });

    it('rejects claimState=business-failed без failedClaimDraft', () => {
        const result = AuthResponseSchema.safeParse({
            ...BASE_RESPONSE,
            claimState: 'business-failed',
        });
        expect(result.success).toBe(false);
    });

    it('rejects claimState=account-failed без partialBusinessSlug', () => {
        const result = AuthResponseSchema.safeParse({
            ...BASE_RESPONSE,
            claimState: 'account-failed',
            failedClaimDraft: VALID_DRAFT,
        });
        expect(result.success).toBe(false);
    });

    it('rejects unknown claimState value', () => {
        const result = AuthResponseSchema.safeParse({
            ...BASE_RESPONSE,
            claimState: 'pending',
            claimedBusinessSlug: 'aB3xQ9k7',
            claimedAccountSlug: 'cD4yR0l8',
        });
        expect(result.success).toBe(false);
    });
});
