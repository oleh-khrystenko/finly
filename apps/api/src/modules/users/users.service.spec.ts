import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { ExecutionTransaction } from './schemas/execution-transaction.schema';
import { User } from './schemas/user.schema';
import { UsersService } from './users.service';

const mockUserDoc = (overrides = {}) => ({
    id: '507f1f77bcf86cd799439011',
    email: 'test@gmail.com',
    provider: { name: 'google', id: 'google-123' },
    profile: {
        firstName: 'John',
        lastName: 'Doe',
        avatar: 'https://photo.url',
    },
    executions: { balance: 0, freeReportUsed: false },
    lastLoginAt: null as Date | null,
    save: jest.fn().mockReturnThis(),
    ...overrides,
});

const mockModel = {
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
    create: jest.fn(),
};

const mockTransactionModel = {
    create: jest.fn(),
    find: jest.fn(),
    deleteMany: jest.fn(),
};

describe('UsersService', () => {
    let service: UsersService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UsersService,
                { provide: getModelToken(User.name), useValue: mockModel },
                {
                    provide: getModelToken(ExecutionTransaction.name),
                    useValue: mockTransactionModel,
                },
            ],
        }).compile();

        service = module.get<UsersService>(UsersService);
        jest.clearAllMocks();
    });

    describe('findByEmail', () => {
        it('should find user by lowercase email', async () => {
            const user = mockUserDoc();
            mockModel.findOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue(user),
            });

            const result = await service.findByEmail('Test@Gmail.com');

            expect(mockModel.findOne).toHaveBeenCalledWith({
                email: 'test@gmail.com',
            });
            expect(result).toBe(user);
        });

        it('should return null when user not found', async () => {
            mockModel.findOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue(null),
            });

            const result = await service.findByEmail('unknown@test.com');

            expect(result).toBeNull();
        });
    });

    describe('findById', () => {
        it('should find user by id', async () => {
            const user = mockUserDoc();
            mockModel.findById.mockReturnValue({
                exec: jest.fn().mockResolvedValue(user),
            });

            const result = await service.findById('507f1f77bcf86cd799439011');

            expect(mockModel.findById).toHaveBeenCalledWith(
                '507f1f77bcf86cd799439011'
            );
            expect(result).toBe(user);
        });
    });

    describe('findOrCreateByGoogle', () => {
        const googleProfile = {
            email: 'Test@Gmail.com',
            firstName: 'John',
            lastName: 'Doe',
            avatar: 'https://photo.url',
            providerId: 'google-123',
        };

        it('should create new user when not found', async () => {
            mockModel.findOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue(null),
            });
            const created = mockUserDoc();
            mockModel.create.mockResolvedValue(created);

            const result = await service.findOrCreateByGoogle(googleProfile);

            expect(mockModel.create).toHaveBeenCalledWith({
                email: 'test@gmail.com',
                provider: { name: 'google', id: 'google-123' },
                profile: {
                    firstName: 'John',
                    lastName: 'Doe',
                    avatar: 'https://photo.url',
                },
                lastLoginAt: expect.any(Date),
            });
            expect(result).toBe(created);
        });

        it('should update lastLoginAt for existing user', async () => {
            const existing = mockUserDoc();
            existing.save.mockResolvedValue(existing);
            mockModel.findOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue(existing),
            });

            const result = await service.findOrCreateByGoogle(googleProfile);

            expect(existing.lastLoginAt).toBeInstanceOf(Date);
            expect(existing.save).toHaveBeenCalled();
            expect(mockModel.create).not.toHaveBeenCalled();
            expect(result).toBe(existing);
        });

        it('should set provider if missing on existing user', async () => {
            const existing = mockUserDoc({
                provider: undefined,
                profile: {
                    firstName: 'John',
                    lastName: 'Doe',
                    avatar: 'https://photo.url',
                },
            });
            existing.save.mockResolvedValue(existing);
            mockModel.findOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue(existing),
            });

            await service.findOrCreateByGoogle(googleProfile);

            expect(existing.provider).toEqual({
                name: 'google',
                id: 'google-123',
            });
        });

        it('should enrich missing name from Google profile', async () => {
            const existing = mockUserDoc({
                profile: {
                    firstName: undefined,
                    lastName: undefined,
                    avatar: 'https://existing.url',
                },
            });
            existing.save.mockResolvedValue(existing);
            mockModel.findOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue(existing),
            });

            await service.findOrCreateByGoogle(googleProfile);

            expect(existing.profile.firstName).toBe('John');
            expect(existing.profile.lastName).toBe('Doe');
        });

        it('should enrich missing avatar from Google profile', async () => {
            const existing = mockUserDoc({
                profile: {
                    firstName: 'Existing',
                    lastName: 'Name',
                    avatar: undefined,
                },
            });
            existing.save.mockResolvedValue(existing);
            mockModel.findOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue(existing),
            });

            await service.findOrCreateByGoogle(googleProfile);

            expect(existing.profile.avatar).toBe('https://photo.url');
        });

        it('should NOT overwrite existing name with Google data', async () => {
            const existing = mockUserDoc({
                profile: {
                    firstName: 'Existing',
                    lastName: 'Name',
                    avatar: 'https://existing.url',
                },
            });
            existing.save.mockResolvedValue(existing);
            mockModel.findOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue(existing),
            });

            await service.findOrCreateByGoogle(googleProfile);

            expect(existing.profile.firstName).toBe('Existing');
            expect(existing.profile.lastName).toBe('Name');
            expect(existing.profile.avatar).toBe('https://existing.url');
        });
    });

    describe('findOrCreateByEmail', () => {
        it('should create new user when not found', async () => {
            mockModel.findOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue(null),
            });
            const created = mockUserDoc({ email: 'new@test.com' });
            mockModel.create.mockResolvedValue(created);

            const result = await service.findOrCreateByEmail('New@Test.com');

            expect(mockModel.create).toHaveBeenCalledWith({
                email: 'new@test.com',
                lastLoginAt: expect.any(Date),
            });
            expect(result).toBe(created);
        });

        it('should update lastLoginAt for existing user', async () => {
            const existing = mockUserDoc();
            existing.save.mockResolvedValue(existing);
            mockModel.findOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue(existing),
            });

            await service.findOrCreateByEmail('test@gmail.com');

            expect(existing.lastLoginAt).toBeInstanceOf(Date);
            expect(existing.save).toHaveBeenCalled();
        });
    });

    describe('addExecutions', () => {
        it('should increment balance and record transaction', async () => {
            mockModel.findByIdAndUpdate.mockResolvedValue(
                mockUserDoc({
                    executions: { balance: 10, freeReportUsed: false },
                })
            );
            mockTransactionModel.create.mockResolvedValue([{}]);

            const result = await service.addExecutions(
                '507f1f77bcf86cd799439011',
                10,
                'pack_purchase'
            );

            expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
                '507f1f77bcf86cd799439011',
                { $inc: { 'executions.balance': 10 } },
                { new: true }
            );
            expect(mockTransactionModel.create).toHaveBeenCalledWith(
                [
                    expect.objectContaining({
                        type: 'credit',
                        action: 'pack_purchase',
                        amount: 10,
                        balanceAfter: 10,
                    }),
                ],
                { session: undefined }
            );
            expect(result).toBe(10);
        });

        it('should return 0 when user not found', async () => {
            mockModel.findByIdAndUpdate.mockResolvedValue(null);
            mockTransactionModel.create.mockResolvedValue([{}]);

            const result = await service.addExecutions(
                '507f1f77bcf86cd799439012',
                5,
                'pack_purchase'
            );

            expect(result).toBe(0);
        });
    });

    describe('setPasswordHash', () => {
        it('should store password hash via findByIdAndUpdate', async () => {
            mockModel.findByIdAndUpdate.mockResolvedValue(undefined);

            await service.setPasswordHash(
                '507f1f77bcf86cd799439011',
                '$2b$10$hash'
            );

            expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
                '507f1f77bcf86cd799439011',
                { passwordHash: '$2b$10$hash' }
            );
        });
    });

    describe('softDelete', () => {
        it('should set deletedAt to current date', async () => {
            mockModel.findByIdAndUpdate.mockResolvedValue(undefined);

            await service.softDelete('507f1f77bcf86cd799439011');

            expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
                '507f1f77bcf86cd799439011',
                {
                    deletedAt: expect.any(Date),
                    accountDeletionRequestedAt: null,
                }
            );
        });
    });

    describe('restore', () => {
        it('should clear deletedAt', async () => {
            mockModel.findByIdAndUpdate.mockResolvedValue(undefined);

            await service.restore('507f1f77bcf86cd799439011');

            expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
                '507f1f77bcf86cd799439011',
                {
                    deletedAt: null,
                    accountDeletionRequestedAt: null,
                    deletionReminderSentAt: null,
                }
            );
        });
    });

    describe('updateProfile', () => {
        it('should update firstName, lastName and avatar', async () => {
            const updated = mockUserDoc({
                profile: {
                    firstName: 'New',
                    lastName: 'Name',
                    avatar: 'https://new.url',
                },
            });
            mockModel.findByIdAndUpdate.mockResolvedValue(updated);

            const result = await service.updateProfile(
                '507f1f77bcf86cd799439011',
                {
                    firstName: 'New',
                    lastName: 'Name',
                    avatar: 'https://new.url',
                }
            );

            expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
                '507f1f77bcf86cd799439011',
                {
                    'profile.firstName': 'New',
                    'profile.lastName': 'Name',
                    'profile.avatar': 'https://new.url',
                },
                { new: true }
            );
            expect(result).toBe(updated);
        });

        it('should not include undefined fields in update', async () => {
            mockModel.findByIdAndUpdate.mockResolvedValue(mockUserDoc());

            await service.updateProfile('507f1f77bcf86cd799439011', {
                firstName: 'Only',
            });

            const updateArg = mockModel.findByIdAndUpdate.mock.calls[0][1];
            expect(updateArg).toEqual({ 'profile.firstName': 'Only' });
            expect(updateArg).not.toHaveProperty('profile.lastName');
            expect(updateArg).not.toHaveProperty('profile.avatar');
        });

        // Sprint 3 §3.4 — bookkeeper toggle (рішення E5).

        it('мутує worksAsBookkeeper на корені user-документа (не у profile)', async () => {
            mockModel.findByIdAndUpdate.mockResolvedValue(
                mockUserDoc({ worksAsBookkeeper: true })
            );

            await service.updateProfile('507f1f77bcf86cd799439011', {
                worksAsBookkeeper: true,
            });

            const updateArg = mockModel.findByIdAndUpdate.mock.calls[0][1];
            expect(updateArg).toEqual({ worksAsBookkeeper: true });
            expect(updateArg).not.toHaveProperty('profile.worksAsBookkeeper');
        });

        it('приймає worksAsBookkeeper=false (вимкнення режиму)', async () => {
            mockModel.findByIdAndUpdate.mockResolvedValue(
                mockUserDoc({ worksAsBookkeeper: false })
            );

            await service.updateProfile('507f1f77bcf86cd799439011', {
                worksAsBookkeeper: false,
            });

            const updateArg = mockModel.findByIdAndUpdate.mock.calls[0][1];
            expect(updateArg).toEqual({ worksAsBookkeeper: false });
        });

        it('combined update: profile-поле + worksAsBookkeeper в одному виклику', async () => {
            mockModel.findByIdAndUpdate.mockResolvedValue(mockUserDoc());

            await service.updateProfile('507f1f77bcf86cd799439011', {
                firstName: 'Олег',
                worksAsBookkeeper: true,
            });

            const updateArg = mockModel.findByIdAndUpdate.mock.calls[0][1];
            expect(updateArg).toEqual({
                'profile.firstName': 'Олег',
                worksAsBookkeeper: true,
            });
        });
    });

    describe('setPendingPostLoginTarget (Sprint 11)', () => {
        const userId = '507f1f77bcf86cd799439011';

        it('writes valid same-origin path via $set', async () => {
            mockModel.updateOne.mockResolvedValue({ matchedCount: 1 });

            await service.setPendingPostLoginTarget(
                userId,
                '/business/biz/account/acc'
            );

            expect(mockModel.updateOne).toHaveBeenCalledWith(
                { _id: userId },
                {
                    $set: {
                        pendingPostLoginTarget: '/business/biz/account/acc',
                    },
                }
            );
        });

        it('throws INVALID_REDIRECT_TARGET on missing leading slash', async () => {
            await expect(
                service.setPendingPostLoginTarget(userId, 'evil.com')
            ).rejects.toMatchObject({
                response: { code: 'INVALID_REDIRECT_TARGET' },
            });
            expect(mockModel.updateOne).not.toHaveBeenCalled();
        });

        it('throws INVALID_REDIRECT_TARGET on absolute URL with protocol', async () => {
            await expect(
                service.setPendingPostLoginTarget(userId, 'http://attacker.com')
            ).rejects.toMatchObject({
                response: { code: 'INVALID_REDIRECT_TARGET' },
            });
            expect(mockModel.updateOne).not.toHaveBeenCalled();
        });

        it('throws INVALID_REDIRECT_TARGET on protocol-relative URL', async () => {
            await expect(
                service.setPendingPostLoginTarget(userId, '//attacker.com')
            ).rejects.toMatchObject({
                response: { code: 'INVALID_REDIRECT_TARGET' },
            });
            expect(mockModel.updateOne).not.toHaveBeenCalled();
        });
    });

    describe('clearPendingPostLoginTarget (Sprint 11)', () => {
        it('issues $unset on the field', async () => {
            mockModel.updateOne.mockResolvedValue({ matchedCount: 1 });

            await service.clearPendingPostLoginTarget(
                '507f1f77bcf86cd799439011'
            );

            expect(mockModel.updateOne).toHaveBeenCalledWith(
                { _id: '507f1f77bcf86cd799439011' },
                { $unset: { pendingPostLoginTarget: 1 } }
            );
        });
    });

    describe('stampProfileCompletionReminder (Sprint 12 §12.1a)', () => {
        const userId = '507f1f77bcf86cd799439011';

        it('Stage 1 claim — atomic updateOne з filter null + $set Date; returns true on match', async () => {
            mockModel.updateOne.mockResolvedValue({ matchedCount: 1 });

            const claimed = await service.stampProfileCompletionReminder(
                userId,
                'first'
            );

            expect(claimed).toBe(true);
            expect(mockModel.updateOne).toHaveBeenCalledWith(
                {
                    _id: userId,
                    'profileCompletionReminders.firstReminderSentAt': null,
                },
                {
                    $set: {
                        'profileCompletionReminders.firstReminderSentAt':
                            expect.any(Date),
                    },
                }
            );
        });

        it('Stage 1 idempotent skip — matchedCount=0 returns false (already-stamped race-loser)', async () => {
            mockModel.updateOne.mockResolvedValue({ matchedCount: 0 });

            const claimed = await service.stampProfileCompletionReminder(
                userId,
                'first'
            );

            expect(claimed).toBe(false);
        });

        it('Stage 2 claim — filter включає prereq-guard firstReminderSentAt: $ne null', async () => {
            mockModel.updateOne.mockResolvedValue({ matchedCount: 1 });

            const claimed = await service.stampProfileCompletionReminder(
                userId,
                'final'
            );

            expect(claimed).toBe(true);
            expect(mockModel.updateOne).toHaveBeenCalledWith(
                {
                    _id: userId,
                    'profileCompletionReminders.finalWarningSentAt': null,
                    'profileCompletionReminders.firstReminderSentAt': {
                        $ne: null,
                    },
                },
                {
                    $set: {
                        'profileCompletionReminders.finalWarningSentAt':
                            expect.any(Date),
                    },
                }
            );
        });

        it('Stage 2 skip без prereq stamp — matchedCount=0 (filter не зматчив)', async () => {
            // БД-state: firstReminderSentAt=null → prereq-guard не пропустив.
            mockModel.updateOne.mockResolvedValue({ matchedCount: 0 });

            const claimed = await service.stampProfileCompletionReminder(
                userId,
                'final'
            );

            expect(claimed).toBe(false);
        });
    });

    describe('resetSingleStamp (Sprint 12 §12.1a)', () => {
        const userId = '507f1f77bcf86cd799439011';

        it('first → $set null на firstReminderSentAt без conditional filter', async () => {
            mockModel.updateOne.mockResolvedValue({ matchedCount: 1 });

            await service.resetSingleStamp(userId, 'first');

            expect(mockModel.updateOne).toHaveBeenCalledWith(
                { _id: userId },
                {
                    $set: {
                        'profileCompletionReminders.firstReminderSentAt': null,
                    },
                }
            );
        });

        it('final → $set null на finalWarningSentAt без conditional filter', async () => {
            mockModel.updateOne.mockResolvedValue({ matchedCount: 1 });

            await service.resetSingleStamp(userId, 'final');

            expect(mockModel.updateOne).toHaveBeenCalledWith(
                { _id: userId },
                {
                    $set: {
                        'profileCompletionReminders.finalWarningSentAt': null,
                    },
                }
            );
        });
    });

    describe('finalizeOrphanCleanup (Sprint 12 §12.1a)', () => {
        it('atomic single updateOne — clears stamps AND $unset pendingPostLoginTarget', async () => {
            mockModel.updateOne.mockResolvedValue({ matchedCount: 1 });

            await service.finalizeOrphanCleanup('507f1f77bcf86cd799439011');

            expect(mockModel.updateOne).toHaveBeenCalledTimes(1);
            expect(mockModel.updateOne).toHaveBeenCalledWith(
                { _id: '507f1f77bcf86cd799439011' },
                {
                    $set: {
                        'profileCompletionReminders.firstReminderSentAt': null,
                        'profileCompletionReminders.finalWarningSentAt': null,
                    },
                    $unset: { pendingPostLoginTarget: 1 },
                }
            );
        });
    });

    describe('stampAcceptedTerms (Sprint 10 §SP-12)', () => {
        it('idempotent filter — викликає updateOne з $ne на termsVersion', async () => {
            mockModel.updateOne.mockResolvedValue({ matchedCount: 0 });
            await service.stampAcceptedTerms('507f1f77bcf86cd799439011', 'v2');

            expect(mockModel.updateOne).toHaveBeenCalledWith(
                {
                    _id: '507f1f77bcf86cd799439011',
                    termsVersion: { $ne: 'v2' },
                },
                {
                    $set: {
                        termsAcceptedAt: expect.any(Date),
                        termsVersion: 'v2',
                    },
                }
            );
        });

        it('overwrite на новий version — той самий update-shape, новий version у $set', async () => {
            mockModel.updateOne.mockResolvedValue({ matchedCount: 1 });
            await service.stampAcceptedTerms('507f1f77bcf86cd799439011', 'v3');

            const updateArg = mockModel.updateOne.mock.calls[0][1];
            expect(updateArg.$set.termsVersion).toBe('v3');
            expect(updateArg.$set.termsAcceptedAt).toBeInstanceOf(Date);
        });

        it('no-op коли version === current — filter $ne блокує match (matchedCount=0)', async () => {
            // Імітуємо БД-state: termsVersion='v2'. Filter $ne: v2 не матчить
            // документ — updateOne повертає matchedCount=0. Метод повертає
            // void без помилки (idempotent semantics).
            mockModel.updateOne.mockResolvedValue({ matchedCount: 0 });
            await expect(
                service.stampAcceptedTerms('507f1f77bcf86cd799439011', 'v2')
            ).resolves.toBeUndefined();
        });
    });
});
