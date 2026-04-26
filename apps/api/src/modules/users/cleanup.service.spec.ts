import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';
import { CleanupService } from './cleanup.service';
import { User } from './schemas/user.schema';

jest.mock('../../config/env', () => ({
    ENV: {
        ACCOUNT_DELETION_GRACE_DAYS: 2,
    },
}));

const mockModel = {
    find: jest.fn(),
    findByIdAndDelete: jest.fn(),
    findByIdAndUpdate: jest.fn(),
};

const mockAuthService = {
    revokeAllUserTokens: jest.fn().mockResolvedValue(undefined),
};

const mockEmailService = {
    sendDeletionReminder: jest.fn().mockResolvedValue(undefined),
};

function mockFindChain(result: unknown[]) {
    return {
        select: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(result),
            }),
        }),
    };
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

describe('CleanupService', () => {
    let service: CleanupService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CleanupService,
                { provide: getModelToken(User.name), useValue: mockModel },
                { provide: AuthService, useValue: mockAuthService },
                { provide: EmailService, useValue: mockEmailService },
            ],
        }).compile();

        service = module.get<CleanupService>(CleanupService);
        jest.clearAllMocks();
    });

    describe('handleExpiredAccounts — hard delete', () => {
        it('should delete users with deletedAt older than grace period', async () => {
            const expiredUsers = [
                { _id: { toString: () => 'user-1' }, email: 'a@test.com' },
                { _id: { toString: () => 'user-2' }, email: 'b@test.com' },
            ];

            mockModel.find
                .mockReturnValueOnce(mockFindChain([]))
                .mockReturnValueOnce(mockFindChain(expiredUsers));

            mockModel.findByIdAndDelete.mockReturnValue({
                exec: jest.fn().mockResolvedValue(undefined),
            });

            await service.handleExpiredAccounts();

            expect(mockAuthService.revokeAllUserTokens).toHaveBeenCalledWith(
                'user-1'
            );
            expect(mockAuthService.revokeAllUserTokens).toHaveBeenCalledWith(
                'user-2'
            );
            expect(mockModel.findByIdAndDelete).toHaveBeenCalledWith('user-1');
            expect(mockModel.findByIdAndDelete).toHaveBeenCalledWith('user-2');
            expect(mockModel.findByIdAndDelete).toHaveBeenCalledTimes(2);
        });

        it('should not delete anything when no expired accounts', async () => {
            mockModel.find
                .mockReturnValueOnce(mockFindChain([]))
                .mockReturnValueOnce(mockFindChain([]));

            await service.handleExpiredAccounts();

            expect(mockAuthService.revokeAllUserTokens).not.toHaveBeenCalled();
            expect(mockModel.findByIdAndDelete).not.toHaveBeenCalled();
        });

        it('should use correct cutoff date based on grace days', async () => {
            mockModel.find
                .mockReturnValueOnce(mockFindChain([]))
                .mockReturnValueOnce(mockFindChain([]));

            const before = new Date(Date.now() - 2 * 86_400_000);
            await service.handleExpiredAccounts();
            const after = new Date(Date.now() - 2 * 86_400_000);

            const cutoffArg = mockModel.find.mock.calls[1][0].deletedAt.$lte;
            expect(cutoffArg.getTime()).toBeGreaterThanOrEqual(
                before.getTime()
            );
            expect(cutoffArg.getTime()).toBeLessThanOrEqual(after.getTime());
        });

        it('should continue deleting other users when one fails', async () => {
            const expiredUsers = [
                { _id: { toString: () => 'user-1' }, email: 'a@test.com' },
                { _id: { toString: () => 'user-2' }, email: 'b@test.com' },
            ];

            mockModel.find
                .mockReturnValueOnce(mockFindChain([]))
                .mockReturnValueOnce(mockFindChain(expiredUsers));

            mockAuthService.revokeAllUserTokens
                .mockRejectedValueOnce(new Error('Redis connection lost'))
                .mockResolvedValueOnce(undefined);

            mockModel.findByIdAndDelete.mockReturnValue({
                exec: jest.fn().mockResolvedValue(undefined),
            });

            await service.handleExpiredAccounts();

            expect(mockAuthService.revokeAllUserTokens).toHaveBeenCalledTimes(
                2
            );
            expect(mockModel.findByIdAndDelete).toHaveBeenCalledWith('user-2');
            expect(mockModel.findByIdAndDelete).toHaveBeenCalledTimes(1);
        });

        it('should revoke tokens before deleting user document', async () => {
            const callOrder: string[] = [];

            mockModel.find
                .mockReturnValueOnce(mockFindChain([]))
                .mockReturnValueOnce(
                    mockFindChain([
                        {
                            _id: { toString: () => 'user-1' },
                            email: 'a@test.com',
                        },
                    ])
                );

            mockAuthService.revokeAllUserTokens.mockImplementation(() => {
                callOrder.push('revoke');
                return Promise.resolve();
            });
            mockModel.findByIdAndDelete.mockReturnValue({
                exec: jest.fn().mockImplementation(() => {
                    callOrder.push('delete');
                    return Promise.resolve();
                }),
            });

            await service.handleExpiredAccounts();

            expect(callOrder).toEqual(['revoke', 'delete']);
        });
    });

    describe('handleExpiredAccounts — deletion reminders', () => {
        it('should send reminder to users in the reminder window', async () => {
            const deletedAt = new Date(Date.now() - 1.5 * 86_400_000);
            const usersToRemind = [
                {
                    _id: { toString: () => 'user-r1' },
                    email: 'remind@test.com',
                    preferredLang: 'en',
                    deletedAt,
                    timezone: null,
                },
            ];

            mockModel.find
                .mockReturnValueOnce(mockFindChain(usersToRemind))
                .mockReturnValueOnce(mockFindChain([]));

            mockModel.findByIdAndUpdate.mockResolvedValue(undefined);

            await service.handleExpiredAccounts();

            expect(mockEmailService.sendDeletionReminder).toHaveBeenCalledWith({
                email: 'remind@test.com',
                deletionDate: expect.any(Date),
                lang: 'en',
            });
            expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
                'user-r1',
                { deletionReminderSentAt: expect.any(Date) }
            );
        });

        it('should not send reminder when no users in window', async () => {
            mockModel.find
                .mockReturnValueOnce(mockFindChain([]))
                .mockReturnValueOnce(mockFindChain([]));

            await service.handleExpiredAccounts();

            expect(
                mockEmailService.sendDeletionReminder
            ).not.toHaveBeenCalled();
        });

        it('should continue sending reminders when one fails', async () => {
            const deletedAt = new Date(Date.now() - 1.5 * 86_400_000);
            const usersToRemind = [
                {
                    _id: { toString: () => 'user-r1' },
                    email: 'fail@test.com',
                    preferredLang: 'en',
                    deletedAt,
                    timezone: null,
                },
                {
                    _id: { toString: () => 'user-r2' },
                    email: 'ok@test.com',
                    preferredLang: 'uk',
                    deletedAt,
                    timezone: null,
                },
            ];

            mockModel.find
                .mockReturnValueOnce(mockFindChain(usersToRemind))
                .mockReturnValueOnce(mockFindChain([]));

            mockEmailService.sendDeletionReminder
                .mockRejectedValueOnce(new Error('Email failed'))
                .mockResolvedValueOnce(undefined);

            mockModel.findByIdAndUpdate.mockResolvedValue(undefined);

            await service.handleExpiredAccounts();

            expect(mockEmailService.sendDeletionReminder).toHaveBeenCalledTimes(
                2
            );
            expect(mockModel.findByIdAndUpdate).toHaveBeenCalledTimes(1);
            expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
                'user-r2',
                { deletionReminderSentAt: expect.any(Date) }
            );
        });

        it('should calculate correct deletion date from deletedAt + grace days', async () => {
            const deletedAt = new Date('2026-03-20T10:00:00Z');
            const usersToRemind = [
                {
                    _id: { toString: () => 'user-r1' },
                    email: 'date@test.com',
                    preferredLang: 'en',
                    deletedAt,
                    timezone: null,
                },
            ];

            mockModel.find
                .mockReturnValueOnce(mockFindChain(usersToRemind))
                .mockReturnValueOnce(mockFindChain([]));

            mockModel.findByIdAndUpdate.mockResolvedValue(undefined);

            await service.handleExpiredAccounts();

            const expectedDeletionDate = new Date('2026-03-22T10:00:00Z');
            expect(mockEmailService.sendDeletionReminder).toHaveBeenCalledWith(
                expect.objectContaining({
                    deletionDate: expectedDeletionDate,
                })
            );
        });

        it('should query with correct reminder and hard-delete cutoffs', async () => {
            mockModel.find
                .mockReturnValueOnce(mockFindChain([]))
                .mockReturnValueOnce(mockFindChain([]));

            const beforeReminder = new Date(Date.now() - 1 * 86_400_000);
            const beforeHardDelete = new Date(Date.now() - 2 * 86_400_000);

            await service.handleExpiredAccounts();

            const afterReminder = new Date(Date.now() - 1 * 86_400_000);
            const afterHardDelete = new Date(Date.now() - 2 * 86_400_000);

            const reminderQuery = mockModel.find.mock.calls[0][0];
            expect(reminderQuery.deletionReminderSentAt).toBeNull();

            const reminderLte = reminderQuery.deletedAt.$lte;
            expect(reminderLte.getTime()).toBeGreaterThanOrEqual(
                beforeReminder.getTime()
            );
            expect(reminderLte.getTime()).toBeLessThanOrEqual(
                afterReminder.getTime()
            );

            const reminderGt = reminderQuery.deletedAt.$gt;
            expect(reminderGt.getTime()).toBeGreaterThanOrEqual(
                beforeHardDelete.getTime()
            );
            expect(reminderGt.getTime()).toBeLessThanOrEqual(
                afterHardDelete.getTime()
            );
        });
    });

    describe('handleExpiredAccounts — timezone delivery window', () => {
        it('should send reminder when user has no timezone (fallback)', async () => {
            const deletedAt = new Date(Date.now() - 1.5 * 86_400_000);

            mockModel.find
                .mockReturnValueOnce(
                    mockFindChain([
                        {
                            _id: { toString: () => 'user-1' },
                            email: 'no-tz@test.com',
                            preferredLang: 'en',
                            deletedAt,
                            timezone: null,
                        },
                    ])
                )
                .mockReturnValueOnce(mockFindChain([]));

            mockModel.findByIdAndUpdate.mockResolvedValue(undefined);

            await service.handleExpiredAccounts();

            expect(mockEmailService.sendDeletionReminder).toHaveBeenCalledTimes(
                1
            );
        });

        it('should send reminder when user timezone is in daytime window', async () => {
            const deletedAt = new Date(Date.now() - 1.5 * 86_400_000);
            const daytimeTimezone = timezoneWithLocalHour(12);

            mockModel.find
                .mockReturnValueOnce(
                    mockFindChain([
                        {
                            _id: { toString: () => 'user-1' },
                            email: 'day@test.com',
                            preferredLang: 'en',
                            deletedAt,
                            timezone: daytimeTimezone,
                        },
                    ])
                )
                .mockReturnValueOnce(mockFindChain([]));

            mockModel.findByIdAndUpdate.mockResolvedValue(undefined);

            await service.handleExpiredAccounts();

            expect(mockEmailService.sendDeletionReminder).toHaveBeenCalledTimes(
                1
            );
        });

        it('should defer reminder when user timezone is in nighttime', async () => {
            const deletedAt = new Date(Date.now() - 1.5 * 86_400_000);
            const nighttimeTimezone = timezoneWithLocalHour(3);

            mockModel.find
                .mockReturnValueOnce(
                    mockFindChain([
                        {
                            _id: { toString: () => 'user-1' },
                            email: 'night@test.com',
                            preferredLang: 'en',
                            deletedAt,
                            timezone: nighttimeTimezone,
                        },
                    ])
                )
                .mockReturnValueOnce(mockFindChain([]));

            await service.handleExpiredAccounts();

            expect(
                mockEmailService.sendDeletionReminder
            ).not.toHaveBeenCalled();
            expect(mockModel.findByIdAndUpdate).not.toHaveBeenCalled();
        });

        it('should send reminder when user has invalid timezone (fallback)', async () => {
            const deletedAt = new Date(Date.now() - 1.5 * 86_400_000);

            mockModel.find
                .mockReturnValueOnce(
                    mockFindChain([
                        {
                            _id: { toString: () => 'user-1' },
                            email: 'bad-tz@test.com',
                            preferredLang: 'en',
                            deletedAt,
                            timezone: 'Invalid/Timezone',
                        },
                    ])
                )
                .mockReturnValueOnce(mockFindChain([]));

            mockModel.findByIdAndUpdate.mockResolvedValue(undefined);

            await service.handleExpiredAccounts();

            expect(mockEmailService.sendDeletionReminder).toHaveBeenCalledTimes(
                1
            );
        });

        it('should mix: send to daytime users, defer nighttime users', async () => {
            const deletedAt = new Date(Date.now() - 1.5 * 86_400_000);
            const daytimeTimezone = timezoneWithLocalHour(10);
            const nighttimeTimezone = timezoneWithLocalHour(2);

            mockModel.find
                .mockReturnValueOnce(
                    mockFindChain([
                        {
                            _id: { toString: () => 'day-user' },
                            email: 'day@test.com',
                            preferredLang: 'en',
                            deletedAt,
                            timezone: daytimeTimezone,
                        },
                        {
                            _id: { toString: () => 'night-user' },
                            email: 'night@test.com',
                            preferredLang: 'uk',
                            deletedAt,
                            timezone: nighttimeTimezone,
                        },
                    ])
                )
                .mockReturnValueOnce(mockFindChain([]));

            mockModel.findByIdAndUpdate.mockResolvedValue(undefined);

            await service.handleExpiredAccounts();

            expect(mockEmailService.sendDeletionReminder).toHaveBeenCalledTimes(
                1
            );
            expect(mockEmailService.sendDeletionReminder).toHaveBeenCalledWith(
                expect.objectContaining({ email: 'day@test.com' })
            );
            expect(mockModel.findByIdAndUpdate).toHaveBeenCalledTimes(1);
            expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
                'day-user',
                { deletionReminderSentAt: expect.any(Date) }
            );
        });
    });
});
