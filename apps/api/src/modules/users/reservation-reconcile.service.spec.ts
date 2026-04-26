import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { User } from './schemas/user.schema';
import { UsersService } from './users.service';
import { ReservationReconcileService } from './reservation-reconcile.service';

const mockUserModel = {
    find: jest.fn(),
};

const mockUsersService = {
    refundReservation: jest.fn(),
};

const expiredReservation = (
    userId: string,
    reservationId: string,
    minutesAgo: number
) => ({
    _id: { toString: () => userId },
    executions: {
        activeReservation: {
            id: reservationId,
            amount: 200,
            feature: 'ai_chat',
            expiresAt: new Date(Date.now() - minutesAgo * 60_000),
            compensationOps: { inc: { 'ai.requestsUsed': -1 } },
        },
    },
});

describe('ReservationReconcileService', () => {
    let service: ReservationReconcileService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ReservationReconcileService,
                { provide: getModelToken(User.name), useValue: mockUserModel },
                { provide: UsersService, useValue: mockUsersService },
            ],
        }).compile();

        service = module.get<ReservationReconcileService>(
            ReservationReconcileService
        );
        jest.clearAllMocks();
    });

    const setupFind = (results: unknown[]) => {
        mockUserModel.find.mockReturnValue({
            limit: jest.fn().mockReturnValue({
                lean: jest.fn().mockReturnValue({
                    exec: jest.fn().mockResolvedValue(results),
                }),
            }),
        });
    };

    it('should find users with expired reservations and refund each', async () => {
        const users = [
            expiredReservation('user-1', 'res-1', 10),
            expiredReservation('user-2', 'res-2', 20),
        ];
        setupFind(users);
        mockUsersService.refundReservation.mockResolvedValue(undefined);

        await service.reconcileExpiredReservations();

        expect(mockUsersService.refundReservation).toHaveBeenCalledTimes(2);
        expect(mockUsersService.refundReservation).toHaveBeenCalledWith(
            'user-1',
            'res-1'
        );
        expect(mockUsersService.refundReservation).toHaveBeenCalledWith(
            'user-2',
            'res-2'
        );
    });

    it('should query with correct filter and projection', async () => {
        setupFind([]);

        await service.reconcileExpiredReservations();

        expect(mockUserModel.find).toHaveBeenCalledWith(
            {
                'executions.activeReservation.expiresAt': {
                    $lt: expect.any(Date),
                },
            },
            { _id: 1, 'executions.activeReservation': 1 }
        );
    });

    it('should do nothing when no expired reservations found', async () => {
        setupFind([]);

        await service.reconcileExpiredReservations();

        expect(mockUsersService.refundReservation).not.toHaveBeenCalled();
    });

    it('should apply batch limit of 100', async () => {
        setupFind([]);

        await service.reconcileExpiredReservations();

        const limitCall = mockUserModel.find.mock.results[0].value.limit;
        expect(limitCall).toHaveBeenCalledWith(100);
    });

    it('should continue batch when individual refund fails', async () => {
        const users = [
            expiredReservation('user-1', 'res-1', 10),
            expiredReservation('user-2', 'res-2', 20),
            expiredReservation('user-3', 'res-3', 30),
        ];
        setupFind(users);

        mockUsersService.refundReservation
            .mockResolvedValueOnce(undefined) // user-1 OK
            .mockRejectedValueOnce(new Error('DB error')) // user-2 fails
            .mockResolvedValueOnce(undefined); // user-3 OK

        await service.reconcileExpiredReservations();

        expect(mockUsersService.refundReservation).toHaveBeenCalledTimes(3);
        // user-3 still processed despite user-2 failure
        expect(mockUsersService.refundReservation).toHaveBeenCalledWith(
            'user-3',
            'res-3'
        );
    });

    it('should skip users with null activeReservation in results', async () => {
        const users = [
            {
                _id: { toString: () => 'user-1' },
                executions: { activeReservation: null },
            },
        ];
        setupFind(users);

        await service.reconcileExpiredReservations();

        expect(mockUsersService.refundReservation).not.toHaveBeenCalled();
    });
});
