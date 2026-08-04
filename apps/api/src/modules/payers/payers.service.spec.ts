import { ConflictException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { PAYERS_MAX_PER_USER } from '@finly/types';

import { PayersService } from './payers.service';
import { Payer } from './schemas/payer.schema';

const USER_ID = new Types.ObjectId('507f1f77bcf86cd799439011');
const PAYER_ID = '507f1f77bcf86cd799439022';

const duplicateKeyError = Object.assign(new Error('E11000'), { code: 11000 });

const mockModel = {
    find: jest.fn(),
    countDocuments: jest.fn(),
    create: jest.fn(),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
    deleteMany: jest.fn(),
};

describe('PayersService', () => {
    let service: PayersService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PayersService,
                { provide: getModelToken(Payer.name), useValue: mockModel },
            ],
        }).compile();

        service = module.get(PayersService);
        jest.clearAllMocks();
    });

    describe('create', () => {
        it('зберігає платника у списку власника', async () => {
            mockModel.countDocuments.mockResolvedValue(3);
            mockModel.create.mockResolvedValue({
                _id: new Types.ObjectId(PAYER_ID),
                fullName: 'Петренко Іван Іванович',
                taxId: '3184710691',
                createdAt: new Date('2026-07-01'),
                updatedAt: new Date('2026-07-01'),
            });

            const result = await service.create(USER_ID, {
                fullName: 'Петренко Іван Іванович',
                taxId: '3184710691',
            });

            expect(mockModel.create).toHaveBeenCalledWith(
                expect.objectContaining({ userId: USER_ID })
            );
            expect(result).toMatchObject({
                id: PAYER_ID,
                fullName: 'Петренко Іван Іванович',
                taxId: '3184710691',
            });
        });

        it('повертає окремий код на повторний РНОКПП замість дубля', async () => {
            mockModel.countDocuments.mockResolvedValue(1);
            mockModel.create.mockRejectedValue(duplicateKeyError);

            await expect(
                service.create(USER_ID, {
                    fullName: 'Петренко Іван Іванович',
                    taxId: '3184710691',
                })
            ).rejects.toThrow(ConflictException);
        });

        it('не приймає запис понад межу списку', async () => {
            mockModel.countDocuments.mockResolvedValue(PAYERS_MAX_PER_USER);

            await expect(
                service.create(USER_ID, {
                    fullName: 'Петренко Іван Іванович',
                    taxId: '3184710691',
                })
            ).rejects.toThrow(ConflictException);
            expect(mockModel.create).not.toHaveBeenCalled();
        });
    });

    describe('update', () => {
        it('шукає запис у межах власника', async () => {
            mockModel.findOneAndUpdate.mockReturnValue({
                exec: jest.fn().mockResolvedValue({
                    _id: new Types.ObjectId(PAYER_ID),
                    fullName: 'Петренко Іван Петрович',
                    taxId: '3184710691',
                    createdAt: new Date('2026-07-01'),
                    updatedAt: new Date('2026-07-02'),
                }),
            });

            await service.update(USER_ID, PAYER_ID, {
                fullName: 'Петренко Іван Петрович',
                taxId: '3184710691',
            });

            expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
                { _id: new Types.ObjectId(PAYER_ID), userId: USER_ID },
                expect.anything(),
                expect.anything()
            );
        });

        it('чужий запис не знаходить (404, а не 403)', async () => {
            mockModel.findOneAndUpdate.mockReturnValue({
                exec: jest.fn().mockResolvedValue(null),
            });

            await expect(
                service.update(USER_ID, PAYER_ID, {
                    fullName: 'Петренко Іван Петрович',
                    taxId: '3184710691',
                })
            ).rejects.toThrow(NotFoundException);
        });
    });

    describe('delete', () => {
        it('видаляє запис власника', async () => {
            mockModel.deleteOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
            });

            await service.delete(USER_ID, PAYER_ID);

            expect(mockModel.deleteOne).toHaveBeenCalledWith({
                _id: new Types.ObjectId(PAYER_ID),
                userId: USER_ID,
            });
        });

        it('невалідний ідентифікатор не доходить до бази', async () => {
            await expect(service.delete(USER_ID, 'not-an-id')).rejects.toThrow(
                NotFoundException
            );
            expect(mockModel.deleteOne).not.toHaveBeenCalled();
        });
    });

    describe('deleteAllForUser', () => {
        it('чистить увесь список власника', async () => {
            mockModel.deleteMany.mockReturnValue({
                exec: jest.fn().mockResolvedValue({ deletedCount: 4 }),
            });

            await expect(service.deleteAllForUser(USER_ID)).resolves.toBe(4);
            expect(mockModel.deleteMany).toHaveBeenCalledWith({
                userId: USER_ID,
            });
        });
    });
});
