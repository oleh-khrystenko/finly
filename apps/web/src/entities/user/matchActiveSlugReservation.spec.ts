import { matchActiveSlugReservation } from './matchActiveSlugReservation';
import type { SlugReservationView } from '@finly/types';

const businessReservation: SlugReservationView = {
    entityType: 'business',
    desiredSlug: 'acme',
    expiresAt: new Date(),
    businessSlug: 'old-biz',
    accountSlug: null,
    invoiceSlug: null,
};

describe('matchActiveSlugReservation (Sprint 20)', () => {
    it("повертає бажане ім'я коли бронь стосується цієї сутності", () => {
        expect(
            matchActiveSlugReservation(businessReservation, {
                entityType: 'business',
                businessSlug: 'old-biz',
            })
        ).toBe('acme');
    });

    it('case-insensitive за шляхом', () => {
        expect(
            matchActiveSlugReservation(businessReservation, {
                entityType: 'business',
                businessSlug: 'OLD-BIZ',
            })
        ).toBe('acme');
    });

    it('null для іншого типу сутності', () => {
        expect(
            matchActiveSlugReservation(businessReservation, {
                entityType: 'account',
                businessSlug: 'old-biz',
                accountSlug: 'acc',
            })
        ).toBeNull();
    });

    it('null коли шлях не збігається', () => {
        expect(
            matchActiveSlugReservation(businessReservation, {
                entityType: 'business',
                businessSlug: 'other-biz',
            })
        ).toBeNull();
    });

    it('account-бронь вимагає збігу і businessSlug, і accountSlug', () => {
        const accountReservation: SlugReservationView = {
            entityType: 'account',
            desiredSlug: 'mono',
            expiresAt: new Date(),
            businessSlug: 'biz',
            accountSlug: 'old-acc',
            invoiceSlug: null,
        };
        expect(
            matchActiveSlugReservation(accountReservation, {
                entityType: 'account',
                businessSlug: 'biz',
                accountSlug: 'old-acc',
            })
        ).toBe('mono');
        expect(
            matchActiveSlugReservation(accountReservation, {
                entityType: 'account',
                businessSlug: 'biz',
                accountSlug: 'other-acc',
            })
        ).toBeNull();
    });

    it('null для відсутньої броні', () => {
        expect(
            matchActiveSlugReservation(null, {
                entityType: 'business',
                businessSlug: 'biz',
            })
        ).toBeNull();
    });
});
