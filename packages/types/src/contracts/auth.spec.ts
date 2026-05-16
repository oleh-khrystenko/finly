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

describe('AuthResponseSchema — Sprint 13 claim discriminated union', () => {
    const BASE_RESPONSE = {
        user: VALID_USER,
        accessToken: 'jwt.access.token',
    };

    it('parses baseline response без claim (login / refresh paths)', () => {
        const result = AuthResponseSchema.safeParse(BASE_RESPONSE);
        expect(result.success).toBe(true);
    });

    it('parses response з claim=null (magic-link verify без anon-draft)', () => {
        const result = AuthResponseSchema.safeParse({
            ...BASE_RESPONSE,
            claim: null,
        });
        expect(result.success).toBe(true);
    });

    it('parses claim.state=success з claimed slugs', () => {
        const result = AuthResponseSchema.safeParse({
            ...BASE_RESPONSE,
            claim: {
                state: 'success',
                claimedBusinessSlug: 'aB3xQ9k7',
                claimedAccountSlug: 'cD4yR0l8',
            },
        });
        expect(result.success).toBe(true);
    });

    it('parses claim.state=business-failed з failedClaimDraft', () => {
        const result = AuthResponseSchema.safeParse({
            ...BASE_RESPONSE,
            claim: {
                state: 'business-failed',
                failedClaimDraft: VALID_DRAFT,
            },
        });
        expect(result.success).toBe(true);
    });

    it('parses claim.state=account-failed з partialBusinessSlug + draft', () => {
        const result = AuthResponseSchema.safeParse({
            ...BASE_RESPONSE,
            claim: {
                state: 'account-failed',
                partialBusinessSlug: 'aB3xQ9k7',
                failedClaimDraft: VALID_DRAFT,
            },
        });
        expect(result.success).toBe(true);
    });

    it('rejects claim.state=success без claimedBusinessSlug', () => {
        const result = AuthResponseSchema.safeParse({
            ...BASE_RESPONSE,
            claim: {
                state: 'success',
                claimedAccountSlug: 'cD4yR0l8',
            },
        });
        expect(result.success).toBe(false);
    });

    it('rejects claim.state=success без claimedAccountSlug', () => {
        const result = AuthResponseSchema.safeParse({
            ...BASE_RESPONSE,
            claim: {
                state: 'success',
                claimedBusinessSlug: 'aB3xQ9k7',
            },
        });
        expect(result.success).toBe(false);
    });

    it('rejects claim.state=business-failed без failedClaimDraft', () => {
        const result = AuthResponseSchema.safeParse({
            ...BASE_RESPONSE,
            claim: {
                state: 'business-failed',
            },
        });
        expect(result.success).toBe(false);
    });

    it('rejects claim.state=account-failed без partialBusinessSlug', () => {
        const result = AuthResponseSchema.safeParse({
            ...BASE_RESPONSE,
            claim: {
                state: 'account-failed',
                failedClaimDraft: VALID_DRAFT,
            },
        });
        expect(result.success).toBe(false);
    });

    it('rejects claim.state=account-failed без failedClaimDraft', () => {
        const result = AuthResponseSchema.safeParse({
            ...BASE_RESPONSE,
            claim: {
                state: 'account-failed',
                partialBusinessSlug: 'aB3xQ9k7',
            },
        });
        expect(result.success).toBe(false);
    });

    it('rejects unknown claim.state value', () => {
        const result = AuthResponseSchema.safeParse({
            ...BASE_RESPONSE,
            claim: {
                state: 'pending',
                claimedBusinessSlug: 'aB3xQ9k7',
                claimedAccountSlug: 'cD4yR0l8',
            },
        });
        expect(result.success).toBe(false);
    });

    it('rejects claim without state discriminator', () => {
        const result = AuthResponseSchema.safeParse({
            ...BASE_RESPONSE,
            claim: {
                claimedBusinessSlug: 'aB3xQ9k7',
                claimedAccountSlug: 'cD4yR0l8',
            },
        });
        expect(result.success).toBe(false);
    });
});
