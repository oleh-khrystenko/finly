import { Test, TestingModule } from '@nestjs/testing';

import { SlugReservationService } from '../slug-reservation/slug-reservation.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const mockUser = {
    id: '507f1f77bcf86cd799439011',
    _id: { toString: () => '507f1f77bcf86cd799439011' },
    email: 'test@gmail.com',
    role: 'user',
    worksAsBookkeeper: false,
    profile: { firstName: 'John', lastName: 'Doe', avatar: null },
    passwordHash: '$2b$10$hash',
    deletedAt: null as Date | null,
    accountDeletionRequestedAt: null as Date | null,
};

const mockUsersService = {
    updateProfile: jest.fn(),
};

const mockSlugReservations = {
    getActiveForUser: jest.fn().mockResolvedValue(null),
    consumeForUser: jest.fn().mockResolvedValue(undefined),
};

describe('UsersController', () => {
    let controller: UsersController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [UsersController],
            providers: [
                { provide: UsersService, useValue: mockUsersService },
                {
                    provide: SlugReservationService,
                    useValue: mockSlugReservations,
                },
            ],
        }).compile();

        controller = module.get<UsersController>(UsersController);
        jest.clearAllMocks();
    });

    describe('GET /users/me', () => {
        it('should return user data in correct format', async () => {
            const result = await controller.getMe(mockUser as any);

            expect(result).toEqual({
                data: {
                    id: '507f1f77bcf86cd799439011',
                    email: 'test@gmail.com',
                    role: 'user',
                    worksAsBookkeeper: false,
                    profile: {
                        firstName: 'John',
                        lastName: 'Doe',
                        avatar: null,
                    },
                    hasPassword: true,
                    deletedAt: null,
                    accountDeletionRequestedAt: null,
                    termsVersion: null,
                    activeSlugReservation: null,
                },
            });
        });

        it('falls back to defaults for legacy users without role / worksAsBookkeeper', async () => {
            const legacy = {
                ...mockUser,
                role: undefined,
                worksAsBookkeeper: undefined,
            };
            const result = await controller.getMe(legacy as any);

            expect(result.data.role).toBe('user');
            expect(result.data.worksAsBookkeeper).toBe(false);
        });

        it('passes through admin role for admin users', async () => {
            const admin = { ...mockUser, role: 'admin' };
            const result = await controller.getMe(admin as any);

            expect(result.data.role).toBe('admin');
        });

        it('passes through worksAsBookkeeper=true', async () => {
            const bookkeeper = { ...mockUser, worksAsBookkeeper: true };
            const result = await controller.getMe(bookkeeper as any);

            expect(result.data.worksAsBookkeeper).toBe(true);
        });

        it('should return hasPassword: false when no passwordHash', async () => {
            const userNoPass = { ...mockUser, passwordHash: null };
            const result = await controller.getMe(userNoPass as any);

            expect(result.data.hasPassword).toBe(false);
        });

        it('should return deletedAt when user is soft-deleted', async () => {
            const deletedDate = new Date('2026-01-01');
            const deletedUser = {
                ...mockUser,
                deletedAt: deletedDate,
            };
            const result = await controller.getMe(deletedUser as any);

            expect(result.data.deletedAt).toBe(deletedDate);
        });
    });

    describe('PATCH /users/me', () => {
        it('should call updateProfile and return updated user', async () => {
            const updated = {
                ...mockUser,
                _id: '507f1f77bcf86cd799439011',
                profile: {
                    firstName: 'New',
                    lastName: 'Name',
                    avatar: 'https://new.url',
                },
            };
            mockUsersService.updateProfile.mockResolvedValue(updated);

            const result = await controller.updateProfile(
                mockUser as any,
                {
                    firstName: 'New',
                    lastName: 'Name',
                    avatar: 'https://new.url',
                } as any
            );

            expect(mockUsersService.updateProfile).toHaveBeenCalledWith(
                '507f1f77bcf86cd799439011',
                {
                    firstName: 'New',
                    lastName: 'Name',
                    avatar: 'https://new.url',
                }
            );
            expect(result.data.profile).toEqual({
                firstName: 'New',
                lastName: 'Name',
                avatar: 'https://new.url',
            });
        });
    });

    describe('DELETE /users/me/slug-reservation', () => {
        it('споживає власну бронь користувача і повертає released', async () => {
            const result = await controller.releaseSlugReservation(
                mockUser as any
            );

            expect(mockSlugReservations.consumeForUser).toHaveBeenCalledWith(
                mockUser._id
            );
            expect(result).toEqual({ data: { released: true } });
        });
    });
});
