import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';

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
    executions: { balance: 0, freeReportUsed: false, activeReservation: null },
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

const mockSession = {
    withTransaction: jest.fn((fn) => fn()),
    endSession: jest.fn(),
};

const mockConnection = {
    startSession: jest.fn().mockResolvedValue(mockSession),
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
                {
                    provide: getConnectionToken(),
                    useValue: mockConnection,
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
            mockTransactionModel.create.mockResolvedValue({});

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
                expect.objectContaining({
                    type: 'credit',
                    action: 'pack_purchase',
                    amount: 10,
                    balanceAfter: 10,
                })
            );
            expect(result).toBe(10);
        });

        it('should return 0 when user not found', async () => {
            mockModel.findByIdAndUpdate.mockResolvedValue(null);
            mockTransactionModel.create.mockResolvedValue({});

            const result = await service.addExecutions(
                '507f1f77bcf86cd799439012',
                5,
                'pack_purchase'
            );

            expect(result).toBe(0);
        });
    });

    describe('deductExecution', () => {
        it('should deduct from balance atomically when balance > 0', async () => {
            mockModel.findOneAndUpdate.mockResolvedValueOnce(
                mockUserDoc({
                    executions: { balance: 2, freeReportUsed: false },
                })
            );

            const result = await service.deductExecution(
                '507f1f77bcf86cd799439011'
            );

            expect(result).toBe(true);
            expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
                {
                    _id: '507f1f77bcf86cd799439011',
                    'executions.balance': { $gt: 0 },
                },
                { $inc: { 'executions.balance': -1 } },
                { new: true }
            );
        });

        it('should use free report atomically when balance is 0 and free report unused', async () => {
            // First call (paid execution) returns null — no balance
            mockModel.findOneAndUpdate.mockResolvedValueOnce(null);
            // Second call (free report) succeeds
            mockModel.findOneAndUpdate.mockResolvedValueOnce(
                mockUserDoc({
                    executions: { balance: 0, freeReportUsed: true },
                })
            );

            const result = await service.deductExecution(
                '507f1f77bcf86cd799439011'
            );

            expect(result).toBe(true);
            expect(mockModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
            expect(mockModel.findOneAndUpdate).toHaveBeenLastCalledWith(
                {
                    _id: '507f1f77bcf86cd799439011',
                    'executions.freeReportUsed': false,
                },
                { $set: { 'executions.freeReportUsed': true } },
                { new: true }
            );
        });

        it('should return false when no executions and free report already used', async () => {
            mockModel.findOneAndUpdate.mockResolvedValueOnce(null);
            mockModel.findOneAndUpdate.mockResolvedValueOnce(null);

            const result = await service.deductExecution(
                '507f1f77bcf86cd799439011'
            );

            expect(result).toBe(false);
        });

        it('should return false when user not found', async () => {
            mockModel.findOneAndUpdate.mockResolvedValueOnce(null);
            mockModel.findOneAndUpdate.mockResolvedValueOnce(null);

            const result = await service.deductExecution('nonexistent');

            expect(result).toBe(false);
        });
    });

    describe('hasExecution', () => {
        it('should return true when balance > 0', async () => {
            const user = mockUserDoc({
                executions: { balance: 1, freeReportUsed: true },
            });
            mockModel.findById.mockReturnValue({
                exec: jest.fn().mockResolvedValue(user),
            });

            expect(await service.hasExecution('507f1f77bcf86cd799439011')).toBe(
                true
            );
        });

        it('should return true when free report available', async () => {
            const user = mockUserDoc({
                executions: { balance: 0, freeReportUsed: false },
            });
            mockModel.findById.mockReturnValue({
                exec: jest.fn().mockResolvedValue(user),
            });

            expect(await service.hasExecution('507f1f77bcf86cd799439011')).toBe(
                true
            );
        });

        it('should return false when no executions and free report used', async () => {
            const user = mockUserDoc({
                executions: { balance: 0, freeReportUsed: true },
            });
            mockModel.findById.mockReturnValue({
                exec: jest.fn().mockResolvedValue(user),
            });

            expect(await service.hasExecution('507f1f77bcf86cd799439011')).toBe(
                false
            );
        });

        it('should return false when user not found', async () => {
            mockModel.findById.mockReturnValue({
                exec: jest.fn().mockResolvedValue(null),
            });

            expect(await service.hasExecution('nonexistent')).toBe(false);
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

    describe('commitReservation', () => {
        const userId = '507f1f77bcf86cd799439011';
        const reservationId = 'test-reservation-uuid';
        const ledgerEntry = { type: 'debit', action: 'ai_chat', amount: 200 };

        it('should claim reservation, read fresh balance, insert ledger, and return balanceAfter', async () => {
            mockModel.updateOne.mockResolvedValue({ matchedCount: 1 });
            mockModel.findOne.mockResolvedValue({
                executions: { balance: 800 },
            });
            mockTransactionModel.create.mockResolvedValue([{}]);

            const result = await service.commitReservation({
                userId,
                reservationId,
                ledgerEntry,
            });

            expect(result).toEqual({ balanceAfter: 800 });

            // Verify claim-first: updateOne with reservation filter
            expect(mockModel.updateOne).toHaveBeenCalledWith(
                {
                    _id: userId,
                    'executions.activeReservation.id': reservationId,
                },
                { $set: { 'executions.activeReservation': null } },
                { session: mockSession }
            );

            // Verify fresh balance read
            expect(mockModel.findOne).toHaveBeenCalledWith(
                { _id: userId },
                { 'executions.balance': 1 },
                { session: mockSession }
            );

            // Verify ledger insert with fresh balance and reservationId
            expect(mockTransactionModel.create).toHaveBeenCalledWith(
                [
                    expect.objectContaining({
                        type: 'debit',
                        action: 'ai_chat',
                        amount: 200,
                        balanceAfter: 800,
                        reservationId,
                    }),
                ],
                { session: mockSession }
            );

            expect(mockSession.endSession).toHaveBeenCalled();
        });

        it('should throw when reservation not found (matchedCount === 0)', async () => {
            mockModel.updateOne.mockResolvedValue({ matchedCount: 0 });

            await expect(
                service.commitReservation({
                    userId,
                    reservationId,
                    ledgerEntry,
                })
            ).rejects.toThrow('Reservation not found or already closed');

            // No ledger insert should happen
            expect(mockTransactionModel.create).not.toHaveBeenCalled();
            expect(mockSession.endSession).toHaveBeenCalled();
        });

        it('should call sideEffectInTx within the transaction', async () => {
            mockModel.updateOne.mockResolvedValue({ matchedCount: 1 });
            mockModel.findOne.mockResolvedValue({
                executions: { balance: 500 },
            });
            mockTransactionModel.create.mockResolvedValue([{}]);

            const sideEffect = jest.fn().mockResolvedValue(undefined);

            await service.commitReservation({
                userId,
                reservationId,
                ledgerEntry,
                sideEffectInTx: sideEffect,
            });

            expect(sideEffect).toHaveBeenCalledWith(mockSession);
        });

        it('should rollback transaction when sideEffectInTx throws', async () => {
            mockModel.updateOne.mockResolvedValue({ matchedCount: 1 });
            mockModel.findOne.mockResolvedValue({
                executions: { balance: 500 },
            });
            mockTransactionModel.create.mockResolvedValue([{}]);

            const sideEffect = jest
                .fn()
                .mockRejectedValue(new Error('History insert failed'));

            // withTransaction propagates the error from the callback
            mockSession.withTransaction.mockImplementationOnce(
                async (fn: () => Promise<void>) => fn()
            );

            await expect(
                service.commitReservation({
                    userId,
                    reservationId,
                    ledgerEntry,
                    sideEffectInTx: sideEffect,
                })
            ).rejects.toThrow('History insert failed');

            expect(mockSession.endSession).toHaveBeenCalled();
        });

        it('should always end session even on error', async () => {
            mockModel.updateOne.mockRejectedValue(
                new Error('DB connection lost')
            );
            mockSession.withTransaction.mockImplementationOnce(
                async (fn: () => Promise<void>) => fn()
            );

            await expect(
                service.commitReservation({
                    userId,
                    reservationId,
                    ledgerEntry,
                })
            ).rejects.toThrow('DB connection lost');

            expect(mockSession.endSession).toHaveBeenCalled();
        });
    });

    describe('refundReservation', () => {
        const userId = '507f1f77bcf86cd799439011';
        const reservationId = 'test-reservation-uuid';

        it('should restore balance and apply compensationOps atomically', async () => {
            // Phase A — read reservation
            mockModel.findOne.mockResolvedValueOnce({
                executions: {
                    activeReservation: {
                        id: reservationId,
                        amount: 200,
                        compensationOps: {
                            inc: { 'ai.requestsUsed': -1 },
                        },
                    },
                },
            });
            // Phase B — atomic update
            mockModel.findOneAndUpdate.mockResolvedValueOnce(mockUserDoc());

            await service.refundReservation(userId, reservationId);

            // Verify merged $inc: balance restore + compensation
            expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
                {
                    _id: userId,
                    'executions.activeReservation.id': reservationId,
                },
                {
                    $inc: {
                        'executions.balance': 200,
                        'ai.requestsUsed': -1,
                    },
                    $set: { 'executions.activeReservation': null },
                }
            );
        });

        it('should be idempotent — no-op when reservation already closed (phase A returns null)', async () => {
            mockModel.findOne.mockResolvedValueOnce(null);

            await service.refundReservation(userId, reservationId);

            expect(mockModel.findOneAndUpdate).not.toHaveBeenCalled();
        });

        it('should be idempotent — no-op when race closes reservation between phase A and B', async () => {
            // Phase A finds reservation
            mockModel.findOne.mockResolvedValueOnce({
                executions: {
                    activeReservation: {
                        id: reservationId,
                        amount: 200,
                        compensationOps: { inc: {} },
                    },
                },
            });
            // Phase B — another process closed it
            mockModel.findOneAndUpdate.mockResolvedValueOnce(null);

            // Should not throw
            await service.refundReservation(userId, reservationId);
        });

        it('should handle empty compensationOps gracefully', async () => {
            mockModel.findOne.mockResolvedValueOnce({
                executions: {
                    activeReservation: {
                        id: reservationId,
                        amount: 200,
                        compensationOps: { inc: {} },
                    },
                },
            });
            mockModel.findOneAndUpdate.mockResolvedValueOnce(mockUserDoc());

            await service.refundReservation(userId, reservationId);

            expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
                {
                    _id: userId,
                    'executions.activeReservation.id': reservationId,
                },
                {
                    $inc: { 'executions.balance': 200 },
                    $set: { 'executions.activeReservation': null },
                }
            );
        });

        it('should handle missing compensationOps (null/undefined)', async () => {
            mockModel.findOne.mockResolvedValueOnce({
                executions: {
                    activeReservation: {
                        id: reservationId,
                        amount: 300,
                        compensationOps: null,
                    },
                },
            });
            mockModel.findOneAndUpdate.mockResolvedValueOnce(mockUserDoc());

            await service.refundReservation(userId, reservationId);

            expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
                {
                    _id: userId,
                    'executions.activeReservation.id': reservationId,
                },
                {
                    $inc: { 'executions.balance': 300 },
                    $set: { 'executions.activeReservation': null },
                }
            );
        });

        it('should not write to ledger on refund', async () => {
            mockModel.findOne.mockResolvedValueOnce({
                executions: {
                    activeReservation: {
                        id: reservationId,
                        amount: 200,
                        compensationOps: {
                            inc: { 'ai.requestsUsed': -1 },
                        },
                    },
                },
            });
            mockModel.findOneAndUpdate.mockResolvedValueOnce(mockUserDoc());

            await service.refundReservation(userId, reservationId);

            expect(mockTransactionModel.create).not.toHaveBeenCalled();
        });
    });
});
