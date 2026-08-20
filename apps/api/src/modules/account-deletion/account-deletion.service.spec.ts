import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { SUBSCRIPTION_STATUS } from '@finly/types';

import { BusinessesService } from '../businesses/businesses.service';
import { ReconciliationService } from '../businesses/reconciliation.service';
import { Business } from '../businesses/schemas/business.schema';
import { PayersService } from '../payers/payers.service';
import { BillingProfile } from '../payments/schemas/billing-profile.schema';
import { CreditLedgerEntry } from '../payments/schemas/credit-ledger-entry.schema';
import { PaymentRecord } from '../payments/schemas/payment-record.schema';
import { ProcessedWebhookEvent } from '../payments/schemas/processed-webhook-event.schema';
import { SlugReservationService } from '../slug-reservation/slug-reservation.service';
import { StorageService } from '../storage/storage.service';
import { User } from '../users/schemas/user.schema';
import { AccountDeletionService } from './account-deletion.service';

const USER_ID = '507f1f77bcf86cd799439011';
const userObjectId = new Types.ObjectId(USER_ID);

const departingBusiness = { _id: new Types.ObjectId(), name: 'Один' };
const survivingId = new Types.ObjectId();

function execOf<T>(value: T) {
    return { exec: jest.fn().mockResolvedValue(value) };
}

describe('AccountDeletionService', () => {
    let service: AccountDeletionService;

    const userModel = {
        exists: jest.fn().mockReturnValue(execOf({ _id: userObjectId })),
        find: jest.fn(),
        findById: jest.fn(),
    };
    const businessModel = {
        find: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        aggregate: jest.fn(),
        distinct: jest.fn().mockResolvedValue([]),
    };
    const profileModel = {
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
        findOne: jest.fn(),
        deleteOne: jest.fn().mockReturnValue(execOf({ deletedCount: 1 })),
        distinct: jest.fn().mockResolvedValue([]),
    };
    const paymentRecordModel = {
        deleteMany: jest.fn().mockReturnValue(execOf({ deletedCount: 2 })),
    };
    const creditLedgerModel = {
        deleteMany: jest.fn().mockReturnValue(execOf({ deletedCount: 0 })),
    };
    const webhookEventModel = {
        deleteMany: jest.fn().mockReturnValue(execOf({ deletedCount: 0 })),
    };
    const businessesService = {
        delete: jest
            .fn()
            .mockResolvedValue({ affectedAccounts: 1, affectedInvoices: 2 }),
    };
    const reconciliation = {
        reconcileBusinesses: jest.fn().mockResolvedValue(true),
    };
    const payersService = {
        deleteAllForUser: jest.fn().mockResolvedValue(0),
    };
    const slugReservations = {
        consumeForUser: jest.fn().mockResolvedValue(null),
    };
    const storage = {
        safeDeleteByUrl: jest.fn().mockResolvedValue(undefined),
    };

    /** `findById(...).lean().exec()` для фото профілю. */
    function stubAvatar(avatar: string | null): void {
        userModel.findById.mockReturnValue({
            lean: jest
                .fn()
                .mockReturnValue(execOf(avatar ? { profile: { avatar } } : {})),
        });
    }

    /**
     * `find` викликається двічі з різними хвостами ланцюга: спершу
     * `.sort().exec()` за тими, хто йде, потім `.lean().exec()` за тими, хто
     * лишається.
     */
    function stubFind(departing: unknown[], surviving: unknown[]): void {
        businessModel.find
            .mockReturnValueOnce({
                sort: jest.fn().mockReturnValue(execOf(departing)),
            })
            .mockReturnValueOnce({
                lean: jest.fn().mockReturnValue(execOf(surviving)),
            });
    }

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AccountDeletionService,
                {
                    provide: getModelToken(User.name),
                    useValue: userModel,
                },
                {
                    provide: getModelToken(Business.name),
                    useValue: businessModel,
                },
                {
                    provide: getModelToken(BillingProfile.name),
                    useValue: profileModel,
                },
                {
                    provide: getModelToken(PaymentRecord.name),
                    useValue: paymentRecordModel,
                },
                {
                    provide: getModelToken(CreditLedgerEntry.name),
                    useValue: creditLedgerModel,
                },
                {
                    provide: getModelToken(ProcessedWebhookEvent.name),
                    useValue: webhookEventModel,
                },
                { provide: BusinessesService, useValue: businessesService },
                { provide: ReconciliationService, useValue: reconciliation },
                { provide: PayersService, useValue: payersService },
                {
                    provide: SlugReservationService,
                    useValue: slugReservations,
                },
                { provide: StorageService, useValue: storage },
            ],
        }).compile();

        service = module.get(AccountDeletionService);
        jest.clearAllMocks();
        userModel.exists.mockReturnValue(execOf({ _id: userObjectId }));
        businessModel.distinct.mockResolvedValue([]);
        profileModel.distinct.mockResolvedValue([]);
        reconciliation.reconcileBusinesses.mockResolvedValue(true);
        profileModel.deleteOne.mockReturnValue(execOf({ deletedCount: 1 }));
        paymentRecordModel.deleteMany.mockReturnValue(
            execOf({ deletedCount: 2 })
        );
        creditLedgerModel.deleteMany.mockReturnValue(
            execOf({ deletedCount: 0 })
        );
        webhookEventModel.deleteMany.mockReturnValue(
            execOf({ deletedCount: 0 })
        );
        storage.safeDeleteByUrl.mockResolvedValue(undefined);
        stubAvatar(null);
    });

    describe('applyDeactivationEffects', () => {
        it('гасить лише тих отримувачів, що підуть, і ставить паузу списань', async () => {
            await service.applyDeactivationEffects(USER_ID);

            const [filter, update] = businessModel.updateMany.mock.calls[0];
            expect(filter.publicitySuspendedAt).toBeNull();
            expect(filter.isSystem).toEqual({ $ne: true });
            expect(update.$set.publicitySuspendedAt).toBeInstanceOf(Date);

            const [profileFilter, profileUpdate] =
                profileModel.updateOne.mock.calls[0];
            expect(profileFilter).toEqual({
                userId: userObjectId,
                billingPausedAt: null,
            });
            expect(profileUpdate.$set.billingPausedAt).toBeInstanceOf(Date);
        });

        it('не чіпає картку, статус і межі оплаченого періоду', async () => {
            await service.applyDeactivationEffects(USER_ID);

            const [, profileUpdate] = profileModel.updateOne.mock.calls[0];
            expect(Object.keys(profileUpdate.$set)).toEqual([
                'billingPausedAt',
            ]);
        });

        it('звіряє деактивацію після запису, а не перед ним', async () => {
            await service.applyDeactivationEffects(USER_ID);

            expect(userModel.exists).toHaveBeenCalledWith({
                _id: userObjectId,
                deletedAt: { $ne: null },
            });
            // Жодного відкоту: акаунт лишився деактивованим.
            expect(businessModel.updateMany).toHaveBeenCalledTimes(1);
            expect(profileModel.updateOne).toHaveBeenCalledTimes(1);
        });

        /**
         * Крон читає список деактивованих заздалегідь; людина може відновити
         * акаунт між читанням і цим викликом. Без відкоту позначки лишились би
         * назавжди — сторінки мертві, списання стоять, і зняти їх нікому.
         */
        it('відкочує позначки, якщо акаунт відновили під час проходу', async () => {
            userModel.exists.mockReturnValue(execOf(null));

            await service.applyDeactivationEffects(USER_ID);

            expect(businessModel.updateMany).toHaveBeenCalledTimes(2);
            const [revertFilter, revertUpdate] =
                businessModel.updateMany.mock.calls[1];
            expect(revertFilter.publicitySuspendedAt).toEqual({ $ne: null });
            expect(revertUpdate).toEqual({
                $set: { publicitySuspendedAt: null },
            });
            expect(profileModel.updateOne).toHaveBeenLastCalledWith(
                { userId: userObjectId, billingPausedAt: { $ne: null } },
                { $set: { billingPausedAt: null } }
            );
        });
    });

    describe('revertDeactivationEffects', () => {
        it('повертає публічність і знімає паузу', async () => {
            await service.revertDeactivationEffects(USER_ID);

            const [filter, update] = businessModel.updateMany.mock.calls[0];
            expect(filter.publicitySuspendedAt).toEqual({ $ne: null });
            expect(update).toEqual({ $set: { publicitySuspendedAt: null } });
            expect(profileModel.updateOne).toHaveBeenCalledWith(
                { userId: userObjectId, billingPausedAt: { $ne: null } },
                { $set: { billingPausedAt: null } }
            );
        });
    });

    describe('applyDeactivationEffectsBestEffort', () => {
        /**
         * Крок за задумом добивається фоновим проходом, тож його збій не сміє
         * обірвати підтвердження: акаунт уже деактивовано, а попереду ще
         * відкликання сесій, лист і очищення cookie.
         */
        it('не піднімає помилку назовні', async () => {
            businessModel.updateMany.mockRejectedValueOnce(
                new Error('mongo down')
            );

            await expect(
                service.applyDeactivationEffectsBestEffort(USER_ID)
            ).resolves.toBeUndefined();
        });
    });

    /**
     * Компенсатор протилежного напрямку: `resyncDeactivationEffects` ходить лише
     * по деактивованих, тож позначку, що пережила відновлення, зняти більше
     * нікому — повторне «Відновити» відбивається як «акаунт не видалено».
     */
    describe('findUsersWithStaleDeactivationEffects', () => {
        it('віддає лише активних людей серед власників, менеджерів і платників', async () => {
            const managerId = new Types.ObjectId();
            businessModel.distinct
                .mockResolvedValueOnce([userObjectId, null])
                .mockResolvedValueOnce([managerId]);
            profileModel.distinct.mockResolvedValueOnce([userObjectId]);
            userModel.find.mockReturnValue({
                lean: jest
                    .fn()
                    .mockReturnValue(execOf([{ _id: userObjectId }])),
            });

            const result =
                await service.findUsersWithStaleDeactivationEffects();

            expect(result).toEqual([USER_ID]);
            const [filter] = userModel.find.mock.calls[0];
            expect(filter.deletedAt).toBeNull();
            // `null`-власники нічийних записів у кандидати не потрапляють.
            expect(filter._id.$in).toEqual([
                userObjectId,
                managerId,
                userObjectId,
            ]);
        });

        it('не ходить у користувачів, коли позначок немає взагалі', async () => {
            const result =
                await service.findUsersWithStaleDeactivationEffects();

            expect(result).toEqual([]);
            expect(userModel.find).not.toHaveBeenCalled();
        });
    });

    describe('purgeUser', () => {
        it('гасить профіль, зносить отримувачів і лише потім прибирає платіжні хвости', async () => {
            stubFind([departingBusiness], []);
            profileModel.findOne.mockReturnValue({
                lean: jest.fn().mockReturnValue(execOf(null)),
            });

            const result = await service.purgeUser(USER_ID);

            expect(result).toBe(true);
            expect(profileModel.updateOne).toHaveBeenCalledWith(
                expect.objectContaining({ userId: userObjectId }),
                expect.objectContaining({
                    $set: expect.objectContaining({
                        status: SUBSCRIPTION_STATUS.CANCELED,
                        cardToken: null,
                    }),
                })
            );
            expect(businessesService.delete).toHaveBeenCalledWith(
                departingBusiness
            );
            expect(profileModel.deleteOne).toHaveBeenCalledWith({
                userId: userObjectId,
            });
            expect(webhookEventModel.deleteMany).toHaveBeenCalledWith({
                userId: USER_ID,
            });
            expect(payersService.deleteAllForUser).toHaveBeenCalledWith(
                userObjectId
            );
            expect(slugReservations.consumeForUser).toHaveBeenCalledWith(
                userObjectId
            );
        });

        it('виводить людину з отримувача, за яким лишається ще хтось', async () => {
            stubFind([], [{ _id: survivingId, ownerId: userObjectId }]);
            profileModel.findOne.mockReturnValue({
                lean: jest.fn().mockReturnValue(execOf(null)),
            });

            await service.purgeUser(USER_ID);

            expect(businessesService.delete).not.toHaveBeenCalled();
            expect(businessModel.updateMany).toHaveBeenCalledWith(
                { _id: { $in: [survivingId] } },
                { $set: { ownerId: null } }
            );
            expect(businessModel.updateMany).toHaveBeenCalledWith(
                { _id: { $in: [survivingId] } },
                { $pull: { managers: userObjectId } }
            );
            expect(reconciliation.reconcileBusinesses).toHaveBeenCalledWith([
                survivingId.toString(),
            ]);
        });

        it('не знищує профіль, поки перерахунок не завершився', async () => {
            stubFind([], [{ _id: survivingId, ownerId: null }]);
            profileModel.findOne.mockReturnValue({
                lean: jest.fn().mockReturnValue(execOf(null)),
            });
            reconciliation.reconcileBusinesses.mockResolvedValue(false);

            const result = await service.purgeUser(USER_ID);

            expect(result).toBe(false);
            expect(profileModel.deleteOne).not.toHaveBeenCalled();
            expect(paymentRecordModel.deleteMany).not.toHaveBeenCalled();
            expect(payersService.deleteAllForUser).not.toHaveBeenCalled();
        });

        /**
         * Адреси файлів живуть лише у записах, які прибирання зносить. Пропущений
         * файл лишився б у публічному сховищі назавжди і без жодного сліду, за
         * яким його можна знайти — ні фото людини, ні логотипа отримувача.
         */
        it('забирає файли бренду отримувача і фото профілю', async () => {
            const branded = {
                _id: new Types.ObjectId(),
                name: 'З логотипом',
                brand: {
                    active: {
                        logoUrl: 'https://media/a-logo.png',
                        centerMarkUrl: 'https://media/a-center.png',
                        bandMarkUrl: 'https://media/a-band.png',
                    },
                    pending: {
                        logoUrl: 'https://media/p-logo.png',
                        centerMarkUrl: 'https://media/p-center.png',
                        bandMarkUrl: 'https://media/p-band.png',
                    },
                },
            };
            stubFind([branded], []);
            stubAvatar('https://media/avatars/x.webp');
            profileModel.findOne.mockReturnValue({
                lean: jest.fn().mockReturnValue(execOf(null)),
            });

            await service.purgeUser(USER_ID);

            const deleted = storage.safeDeleteByUrl.mock.calls.map(
                ([url]) => url
            );
            expect(deleted).toEqual([
                'https://media/a-logo.png',
                'https://media/a-center.png',
                'https://media/a-band.png',
                'https://media/p-logo.png',
                'https://media/p-center.png',
                'https://media/p-band.png',
                'https://media/avatars/x.webp',
            ]);
        });

        /**
         * Недоступне сховище не сміє заморозити видалення даних людини: файл —
         * хвіст, а не умова. Інакше один збій R2 тримав би акаунт у базі вічно.
         */
        it('не валить прибирання, якщо сховище недоступне', async () => {
            const branded = {
                _id: new Types.ObjectId(),
                name: 'З логотипом',
                brand: {
                    active: {
                        logoUrl: 'https://media/a-logo.png',
                        centerMarkUrl: 'https://media/a-center.png',
                        bandMarkUrl: 'https://media/a-band.png',
                    },
                    pending: null,
                },
            };
            stubFind([branded], []);
            storage.safeDeleteByUrl.mockRejectedValue(new Error('R2 down'));
            profileModel.findOne.mockReturnValue({
                lean: jest.fn().mockReturnValue(execOf(null)),
            });

            await expect(service.purgeUser(USER_ID)).resolves.toBe(true);
            expect(payersService.deleteAllForUser).toHaveBeenCalled();
        });

        it('перерахунок бере і прикріплення профілю, і тих, хто вижив', async () => {
            const attached = new Types.ObjectId();
            const pending = new Types.ObjectId();
            stubFind([], [{ _id: survivingId, ownerId: null }]);
            profileModel.findOne.mockReturnValue({
                lean: jest.fn().mockReturnValue(
                    execOf({
                        brand: { attachedBusinessIds: [attached] },
                        documents: { attachedBusinessIds: [] },
                        pendingReconcileBusinessIds: [pending],
                    })
                ),
            });

            await service.purgeUser(USER_ID);

            const [ids] = reconciliation.reconcileBusinesses.mock.calls[0];
            expect([...ids].sort()).toEqual(
                [
                    survivingId.toString(),
                    attached.toString(),
                    pending.toString(),
                ].sort()
            );
        });
    });
});
