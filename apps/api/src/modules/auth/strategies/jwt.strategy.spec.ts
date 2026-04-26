import { Test, TestingModule } from '@nestjs/testing';

import { UsersService } from '../../users/users.service';
import { JwtStrategy } from './jwt.strategy';

jest.mock('../../../config/env', () => ({
    ENV: {
        JWT_ACCESS_SECRET: 'test-secret',
    },
}));

const mockUsersService = {
    findById: jest.fn(),
};

describe('JwtStrategy', () => {
    let strategy: JwtStrategy;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                JwtStrategy,
                { provide: UsersService, useValue: mockUsersService },
            ],
        }).compile();

        strategy = module.get<JwtStrategy>(JwtStrategy);
        jest.clearAllMocks();
    });

    describe('validate', () => {
        const payload = {
            sub: '507f1f77bcf86cd799439011',
            email: 'test@example.com',
        };

        it('should return user for valid payload', async () => {
            const user = {
                _id: payload.sub,
                email: payload.email,
                deletedAt: null,
            };
            mockUsersService.findById.mockResolvedValue(user);

            const result = await strategy.validate(payload);

            expect(result).toBe(user);
            expect(mockUsersService.findById).toHaveBeenCalledWith(payload.sub);
        });

        it('should return null when user not found', async () => {
            mockUsersService.findById.mockResolvedValue(null);

            const result = await strategy.validate(payload);

            expect(result).toBeNull();
        });

        it('should return soft-deleted user (filtering is done by JwtActiveGuard)', async () => {
            const deletedUser = {
                _id: payload.sub,
                email: payload.email,
                deletedAt: new Date('2026-01-01'),
            };
            mockUsersService.findById.mockResolvedValue(deletedUser);

            const result = await strategy.validate(payload);

            expect(result).toBe(deletedUser);
        });
    });
});
