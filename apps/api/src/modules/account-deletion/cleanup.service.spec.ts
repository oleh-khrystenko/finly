import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';
import { User } from '../users/schemas/user.schema';
import { AccountDeletionService } from './account-deletion.service';
import { CleanupService } from './cleanup.service';

jest.mock('../../config/cleanup.config', () => ({
    ACCOUNT_DELETION_GRACE_DAYS: 2,
}));

const USER_ID_1 = '64b0000000000000000000a1';
const USER_ID_2 = '64b0000000000000000000a2';

const mockModel = {
    find: jest.fn(),
    updateMany: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
};

const mockAuthService = {
    revokeAllUserTokens: jest.fn(),
};

const mockEmailService = {
    sendDeletionReminder: jest.fn(),
};

const mockAccountDeletion = {
    applyDeactivationEffectsBestEffort: jest.fn(),
    revertDeactivationEffects: jest.fn(),
    findUsersWithStaleDeactivationEffects: jest.fn(),
    purgeUser: jest.fn(),
};

function userRow(id: string, fields: Record<string, unknown> = {}) {
    return { _id: { toString: () => id }, ...fields };
}

function findChain(result: unknown[]) {
    return {
        select: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(result),
            }),
        }),
    };
}

function selectLeanExec(result: unknown) {
    return {
        select: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(result),
            }),
        }),
    };
}

/**
 * `handleExpiredAccounts` робить рівно три вибірки користувачів і завжди в
 * цьому порядку: деактивовані (добивання ефектів) → кандидати на нагадування →
 * протерміновані на остаточне прибирання. Хелпер задає всі три однією
 * інструкцією, щоб тести не рахували виклики руками.
 */
function mockPass({
    deactivated = [] as unknown[],
    toRemind = [] as unknown[],
    expired = [] as unknown[],
} = {}) {
    mockModel.find
        .mockReturnValueOnce(findChain(deactivated))
        .mockReturnValueOnce(findChain(toRemind))
        .mockReturnValueOnce(findChain(expired));
}

/** Returns an IANA timezone where the current local hour matches `targetHour`. */
function timezoneWithLocalHour(targetHour: number): string {
    const now = new Date();
    const utcHour = now.getUTCHours();
    // offset = targetHour - utcHour (mod 24), mapped to [-12, +14]
    let offset = targetHour - utcHour;
    if (offset < -12) offset += 24;
    if (offset > 14) offset -= 24;
    // Etc/GMT sign is inverted: Etc/GMT-5 = UTC+5
    const etcOffset = -offset;
    const sign = etcOffset >= 0 ? '+' : '';
    return `Etc/GMT${sign}${etcOffset}`;
}

describe('CleanupService (Sprint 31)', () => {
    let service: CleanupService;

    beforeEach(async () => {
        jest.resetAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CleanupService,
                { provide: getModelToken(User.name), useValue: mockModel },
                { provide: AuthService, useValue: mockAuthService },
                { provide: EmailService, useValue: mockEmailService },
                {
                    provide: AccountDeletionService,
                    useValue: mockAccountDeletion,
                },
            ],
        }).compile();

        service = module.get(CleanupService);

        // Штатний прохід: нічого не знайдено, все, що знайдеться, відпрацьовує
        // успішно. Кожен тест перевизначає лише свою ділянку.
        mockModel.find.mockReturnValue(findChain([]));
        mockModel.updateMany.mockReturnValue({
            exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        });
        mockModel.findOneAndUpdate.mockReturnValue(
            selectLeanExec({ _id: USER_ID_1 })
        );
        mockModel.findByIdAndUpdate.mockResolvedValue(undefined);
        mockModel.findByIdAndDelete.mockReturnValue({
            exec: jest.fn().mockResolvedValue(undefined),
        });
        mockAuthService.revokeAllUserTokens.mockResolvedValue(undefined);
        mockEmailService.sendDeletionReminder.mockResolvedValue(undefined);
        mockAccountDeletion.applyDeactivationEffectsBestEffort.mockResolvedValue(
            undefined
        );
        mockAccountDeletion.revertDeactivationEffects.mockResolvedValue(
            undefined
        );
        mockAccountDeletion.findUsersWithStaleDeactivationEffects.mockResolvedValue(
            []
        );
        mockAccountDeletion.purgeUser.mockResolvedValue(true);
    });

    /**
     * Кроки проходу незалежні: перший з них лише прибирає протерміновані
     * позначки, і його збій не має права зняти остаточне видалення акаунтів,
     * термін яких уже минув. Помилка при цьому мусить лишити слід — інакше
     * пропущений прохід нічим не пояснити.
     */
    describe('ізоляція кроків', () => {
        it('збій одного кроку не спиняє решту проходу', async () => {
            mockModel.updateMany.mockReturnValue({
                exec: jest.fn().mockRejectedValue(new Error('mongo down')),
            });
            mockPass({ expired: [userRow(USER_ID_1)] });

            await expect(
                service.handleExpiredAccounts()
            ).resolves.toBeUndefined();

            expect(mockAccountDeletion.purgeUser).toHaveBeenCalledWith(
                USER_ID_1
            );
            expect(mockModel.findByIdAndDelete).toHaveBeenCalledWith(USER_ID_1);
        });
    });

    describe('позначка «лист надіслано»', () => {
        it('знімає протерміновану позначку лише у живих акаунтів', async () => {
            mockPass();

            const before = Date.now() - 15 * 60_000;
            await service.handleExpiredAccounts();
            const after = Date.now() - 15 * 60_000;

            const [filter, update] = mockModel.updateMany.mock.calls[0];
            expect(filter.deletedAt).toBeNull();
            expect(filter.accountDeletionRequestedAt.$ne).toBeNull();
            expect(
                filter.accountDeletionRequestedAt.$lte.getTime()
            ).toBeGreaterThanOrEqual(before);
            expect(
                filter.accountDeletionRequestedAt.$lte.getTime()
            ).toBeLessThanOrEqual(after);
            expect(update).toEqual({
                $set: { accountDeletionRequestedAt: null },
            });
        });
    });

    describe('добивання ефектів підтвердження', () => {
        it('проходить по кожному деактивованому акаунту', async () => {
            mockPass({
                deactivated: [userRow(USER_ID_1), userRow(USER_ID_2)],
            });

            await service.handleExpiredAccounts();

            expect(
                mockAccountDeletion.applyDeactivationEffectsBestEffort
            ).toHaveBeenCalledWith(USER_ID_1);
            expect(
                mockAccountDeletion.applyDeactivationEffectsBestEffort
            ).toHaveBeenCalledWith(USER_ID_2);
        });

        it('нічого не робить, коли деактивованих немає', async () => {
            mockPass();

            await service.handleExpiredAccounts();

            expect(
                mockAccountDeletion.applyDeactivationEffectsBestEffort
            ).not.toHaveBeenCalled();
        });
    });

    describe('позначки, що пережили відновлення', () => {
        it('знімає їх у кожного знайденого', async () => {
            mockPass();
            mockAccountDeletion.findUsersWithStaleDeactivationEffects.mockResolvedValue(
                [USER_ID_1, USER_ID_2]
            );

            await service.handleExpiredAccounts();

            expect(
                mockAccountDeletion.revertDeactivationEffects
            ).toHaveBeenCalledWith(USER_ID_1);
            expect(
                mockAccountDeletion.revertDeactivationEffects
            ).toHaveBeenCalledWith(USER_ID_2);
        });

        it('збій на одному не спиняє решту', async () => {
            mockPass();
            mockAccountDeletion.findUsersWithStaleDeactivationEffects.mockResolvedValue(
                [USER_ID_1, USER_ID_2]
            );
            mockAccountDeletion.revertDeactivationEffects
                .mockRejectedValueOnce(new Error('mongo down'))
                .mockResolvedValueOnce(undefined);

            await service.handleExpiredAccounts();

            expect(
                mockAccountDeletion.revertDeactivationEffects
            ).toHaveBeenCalledTimes(2);
        });
    });

    describe('остаточне прибирання', () => {
        it('прибирає хвости, відкликає сесії і видаляє запис людини', async () => {
            mockPass({
                expired: [
                    userRow(USER_ID_1, { email: 'a@test.com' }),
                    userRow(USER_ID_2, { email: 'b@test.com' }),
                ],
            });

            await service.handleExpiredAccounts();

            expect(mockAccountDeletion.purgeUser).toHaveBeenCalledWith(
                USER_ID_1
            );
            expect(mockAccountDeletion.purgeUser).toHaveBeenCalledWith(
                USER_ID_2
            );
            expect(mockModel.findByIdAndDelete).toHaveBeenCalledWith(USER_ID_1);
            expect(mockModel.findByIdAndDelete).toHaveBeenCalledWith(USER_ID_2);
            expect(mockModel.findByIdAndDelete).toHaveBeenCalledTimes(2);
        });

        it('нічого не видаляє, коли протермінованих немає', async () => {
            mockPass();

            await service.handleExpiredAccounts();

            expect(mockAccountDeletion.purgeUser).not.toHaveBeenCalled();
            expect(mockModel.findByIdAndDelete).not.toHaveBeenCalled();
        });

        it('рахує межу вікна відновлення від тривалості пільгового періоду', async () => {
            mockPass();

            const before = Date.now() - 2 * 86_400_000;
            await service.handleExpiredAccounts();
            const after = Date.now() - 2 * 86_400_000;

            const cutoff = mockModel.find.mock.calls[2][0].deletedAt.$lte;
            expect(cutoff.getTime()).toBeGreaterThanOrEqual(before);
            expect(cutoff.getTime()).toBeLessThanOrEqual(after);
        });

        it('порядок: спершу хвости, потім сесії, і лише тоді сам запис', async () => {
            const order: string[] = [];
            mockPass({
                expired: [userRow(USER_ID_1, { email: 'a@test.com' })],
            });

            mockAccountDeletion.purgeUser.mockImplementation(() => {
                order.push('purge');
                return Promise.resolve(true);
            });
            mockAuthService.revokeAllUserTokens.mockImplementation(() => {
                order.push('revoke');
                return Promise.resolve();
            });
            mockModel.findByIdAndDelete.mockReturnValue({
                exec: jest.fn().mockImplementation(() => {
                    order.push('delete');
                    return Promise.resolve();
                }),
            });

            await service.handleExpiredAccounts();

            expect(order).toEqual(['purge', 'revoke', 'delete']);
        });

        it('збій на одному акаунті не спиняє решту', async () => {
            mockPass({
                expired: [
                    userRow(USER_ID_1, { email: 'a@test.com' }),
                    userRow(USER_ID_2, { email: 'b@test.com' }),
                ],
            });
            mockAccountDeletion.purgeUser
                .mockRejectedValueOnce(new Error('Mongo connection lost'))
                .mockResolvedValueOnce(true);

            await service.handleExpiredAccounts();

            expect(mockModel.findByIdAndDelete).toHaveBeenCalledTimes(1);
            expect(mockModel.findByIdAndDelete).toHaveBeenCalledWith(USER_ID_2);
        });

        // Незавершений перерахунок лишає платіжний профіль погашеним, але
        // живим: без нього нічим знайти отримувачів, з яких треба зняти платні
        // можливості. Людина мусить дожити до наступного проходу.
        it('відкладає видалення, коли перерахунок не завершився', async () => {
            mockPass({
                expired: [userRow(USER_ID_1, { email: 'a@test.com' })],
            });
            mockAccountDeletion.purgeUser.mockResolvedValue(false);

            await service.handleExpiredAccounts();

            expect(mockAuthService.revokeAllUserTokens).not.toHaveBeenCalled();
            expect(mockModel.findByIdAndDelete).not.toHaveBeenCalled();
        });
    });

    describe('замок проти відновлення посеред проходу', () => {
        it('позначає акаунт під умовою «деактивація досі чинна»', async () => {
            mockPass({
                expired: [userRow(USER_ID_1, { email: 'a@test.com' })],
            });

            await service.handleExpiredAccounts();

            const [filter, update] = mockModel.findOneAndUpdate.mock.calls[0];
            expect(filter._id).toBe(USER_ID_1);
            expect(filter.deletedAt.$lte).toBeInstanceOf(Date);
            expect(update).toEqual({
                $set: { accountPurgeStartedAt: expect.any(Date) },
            });
        });

        // Людина натиснула «Відновити» вже після того, як прохід прочитав
        // список. Умова всередині запису не зійдеться — і жоден її отримувач не
        // постраждає.
        it('пропускає акаунт, який встигли відновити, і не чіпає його дані', async () => {
            mockPass({
                expired: [
                    userRow(USER_ID_1, { email: 'a@test.com' }),
                    userRow(USER_ID_2, { email: 'b@test.com' }),
                ],
            });
            mockModel.findOneAndUpdate
                .mockReturnValueOnce(selectLeanExec(null))
                .mockReturnValueOnce(selectLeanExec({ _id: USER_ID_2 }));

            await service.handleExpiredAccounts();

            expect(mockAccountDeletion.purgeUser).toHaveBeenCalledTimes(1);
            expect(mockAccountDeletion.purgeUser).toHaveBeenCalledWith(
                USER_ID_2
            );
            expect(mockModel.findByIdAndDelete).toHaveBeenCalledTimes(1);
            expect(mockModel.findByIdAndDelete).toHaveBeenCalledWith(USER_ID_2);
        });
    });

    describe('нагадування перед видаленням', () => {
        it('шле лист тим, хто у вікні нагадування', async () => {
            mockPass({
                toRemind: [
                    userRow(USER_ID_1, {
                        email: 'remind@test.com',
                        deletedAt: new Date(Date.now() - 1.5 * 86_400_000),
                        timezone: null,
                    }),
                ],
            });

            await service.handleExpiredAccounts();

            expect(mockEmailService.sendDeletionReminder).toHaveBeenCalledWith({
                email: 'remind@test.com',
                deletionDate: expect.any(Date),
            });
            expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
                USER_ID_1,
                { deletionReminderSentAt: expect.any(Date) }
            );
        });

        it('не шле нічого, коли у вікні нікого немає', async () => {
            mockPass();

            await service.handleExpiredAccounts();

            expect(
                mockEmailService.sendDeletionReminder
            ).not.toHaveBeenCalled();
        });

        it('збій листа не спиняє решту і не ставить штамп', async () => {
            mockPass({
                toRemind: [
                    userRow(USER_ID_1, {
                        email: 'fail@test.com',
                        deletedAt: new Date(Date.now() - 1.5 * 86_400_000),
                        timezone: null,
                    }),
                    userRow(USER_ID_2, {
                        email: 'ok@test.com',
                        deletedAt: new Date(Date.now() - 1.5 * 86_400_000),
                        timezone: null,
                    }),
                ],
            });
            mockEmailService.sendDeletionReminder
                .mockRejectedValueOnce(new Error('Email failed'))
                .mockResolvedValueOnce(undefined);

            await service.handleExpiredAccounts();

            expect(mockEmailService.sendDeletionReminder).toHaveBeenCalledTimes(
                2
            );
            expect(mockModel.findByIdAndUpdate).toHaveBeenCalledTimes(1);
            expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
                USER_ID_2,
                { deletionReminderSentAt: expect.any(Date) }
            );
        });

        it('дата видалення у листі рахується від деактивації плюс пільговий період', async () => {
            mockPass({
                toRemind: [
                    userRow(USER_ID_1, {
                        email: 'date@test.com',
                        deletedAt: new Date('2026-03-20T10:00:00Z'),
                        timezone: null,
                    }),
                ],
            });

            await service.handleExpiredAccounts();

            expect(mockEmailService.sendDeletionReminder).toHaveBeenCalledWith(
                expect.objectContaining({
                    deletionDate: new Date('2026-03-22T10:00:00Z'),
                })
            );
        });

        it('вибірка бере лише тих, хто ще не отримував нагадування, і лише у вікні', async () => {
            mockPass();

            const beforeReminder = Date.now() - 86_400_000;
            const beforeHardDelete = Date.now() - 2 * 86_400_000;
            await service.handleExpiredAccounts();
            const afterReminder = Date.now() - 86_400_000;
            const afterHardDelete = Date.now() - 2 * 86_400_000;

            const query = mockModel.find.mock.calls[1][0];
            expect(query.deletionReminderSentAt).toBeNull();
            expect(query.deletedAt.$lte.getTime()).toBeGreaterThanOrEqual(
                beforeReminder
            );
            expect(query.deletedAt.$lte.getTime()).toBeLessThanOrEqual(
                afterReminder
            );
            expect(query.deletedAt.$gt.getTime()).toBeGreaterThanOrEqual(
                beforeHardDelete
            );
            expect(query.deletedAt.$gt.getTime()).toBeLessThanOrEqual(
                afterHardDelete
            );
        });
    });

    describe('вікно доставки за часовим поясом', () => {
        const remindRow = (timezone: string | null) =>
            userRow(USER_ID_1, {
                email: 'tz@test.com',
                deletedAt: new Date(Date.now() - 1.5 * 86_400_000),
                timezone,
            });

        it('без часового поясу шле одразу', async () => {
            mockPass({ toRemind: [remindRow(null)] });

            await service.handleExpiredAccounts();

            expect(mockEmailService.sendDeletionReminder).toHaveBeenCalledTimes(
                1
            );
        });

        it('удень шле', async () => {
            mockPass({ toRemind: [remindRow(timezoneWithLocalHour(12))] });

            await service.handleExpiredAccounts();

            expect(mockEmailService.sendDeletionReminder).toHaveBeenCalledTimes(
                1
            );
        });

        it('уночі відкладає', async () => {
            mockPass({ toRemind: [remindRow(timezoneWithLocalHour(3))] });

            await service.handleExpiredAccounts();

            expect(
                mockEmailService.sendDeletionReminder
            ).not.toHaveBeenCalled();
            expect(mockModel.findByIdAndUpdate).not.toHaveBeenCalled();
        });

        it('на нерозпізнаному поясі шле (fallback)', async () => {
            mockPass({ toRemind: [remindRow('Invalid/Timezone')] });

            await service.handleExpiredAccounts();

            expect(mockEmailService.sendDeletionReminder).toHaveBeenCalledTimes(
                1
            );
        });

        it('змішаний випадок: денним шле, нічних відкладає', async () => {
            mockPass({
                toRemind: [
                    userRow(USER_ID_1, {
                        email: 'day@test.com',
                        deletedAt: new Date(Date.now() - 1.5 * 86_400_000),
                        timezone: timezoneWithLocalHour(10),
                    }),
                    userRow(USER_ID_2, {
                        email: 'night@test.com',
                        deletedAt: new Date(Date.now() - 1.5 * 86_400_000),
                        timezone: timezoneWithLocalHour(2),
                    }),
                ],
            });

            await service.handleExpiredAccounts();

            expect(mockEmailService.sendDeletionReminder).toHaveBeenCalledTimes(
                1
            );
            expect(mockEmailService.sendDeletionReminder).toHaveBeenCalledWith(
                expect.objectContaining({ email: 'day@test.com' })
            );
            expect(mockModel.findByIdAndUpdate).toHaveBeenCalledTimes(1);
            expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
                USER_ID_1,
                { deletionReminderSentAt: expect.any(Date) }
            );
        });
    });
});
