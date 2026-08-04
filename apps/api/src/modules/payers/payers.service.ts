import {
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
    PAYERS_MAX_PER_USER,
    RESPONSE_CODE,
    type CreatePayerDto,
    type PayerView,
    type UpdatePayerDto,
} from '@finly/types';

import { Payer, PayerDocument } from './schemas/payer.schema';

/** Код дубліката унікального індексу Mongo. */
const DUPLICATE_KEY_ERROR = 11000;

function isDuplicateKeyError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === DUPLICATE_KEY_ERROR
    );
}

function toView(payer: PayerDocument): PayerView {
    return {
        id: payer._id.toString(),
        fullName: payer.fullName,
        taxId: payer.taxId,
        createdAt: payer.createdAt,
        updatedAt: payer.updatedAt,
    };
}

/**
 * Sprint 30 — список платників користувача. Кожна операція звужена по `userId`
 * у самому фільтрі, а не перевіркою після читання: чужий запис у такій моделі
 * структурно не може бути знайдений, тож «404 замість 403» виходить сам собою і
 * відповідь не підтверджує існування чужих персональних даних.
 */
@Injectable()
export class PayersService {
    constructor(
        @InjectModel(Payer.name)
        private readonly payerModel: Model<PayerDocument>
    ) {}

    async list(userId: Types.ObjectId): Promise<PayerView[]> {
        const payers = await this.payerModel
            .find({ userId })
            .sort({ createdAt: -1 })
            .exec();
        return payers.map(toView);
    }

    async create(
        userId: Types.ObjectId,
        dto: CreatePayerDto
    ): Promise<PayerView> {
        // Межа — анти-abuse поріг допоміжного списку, а не облікова величина:
        // паралельні запити з двох вкладок теоретично можуть дати на кілька
        // записів більше, і нічого нижче за течією від точного числа не
        // залежить. Лічильник заради цього не заводимо.
        const existing = await this.payerModel.countDocuments({ userId });
        if (existing >= PAYERS_MAX_PER_USER) {
            throw new ConflictException({
                code: RESPONSE_CODE.PAYER_LIMIT_REACHED,
                message: `Payer limit reached (${PAYERS_MAX_PER_USER})`,
            });
        }

        try {
            const payer = await this.payerModel.create({
                userId,
                fullName: dto.fullName,
                taxId: dto.taxId,
            });
            return toView(payer);
        } catch (error) {
            // Унікальність перевіряє індекс, а не попереднє читання: два
            // паралельні збереження того самого клієнта інакше дали б дубль.
            if (isDuplicateKeyError(error)) {
                throw new ConflictException({
                    code: RESPONSE_CODE.PAYER_TAX_ID_DUPLICATE,
                    message: 'Payer with this tax ID already exists',
                });
            }
            throw error;
        }
    }

    async update(
        userId: Types.ObjectId,
        payerId: string,
        dto: UpdatePayerDto
    ): Promise<PayerView> {
        if (!Types.ObjectId.isValid(payerId)) {
            throw this.notFound();
        }
        try {
            const updated = await this.payerModel
                .findOneAndUpdate(
                    { _id: new Types.ObjectId(payerId), userId },
                    { $set: { fullName: dto.fullName, taxId: dto.taxId } },
                    { new: true }
                )
                .exec();
            if (!updated) {
                throw this.notFound();
            }
            return toView(updated);
        } catch (error) {
            if (isDuplicateKeyError(error)) {
                throw new ConflictException({
                    code: RESPONSE_CODE.PAYER_TAX_ID_DUPLICATE,
                    message: 'Payer with this tax ID already exists',
                });
            }
            throw error;
        }
    }

    async delete(userId: Types.ObjectId, payerId: string): Promise<void> {
        if (!Types.ObjectId.isValid(payerId)) {
            throw this.notFound();
        }
        const result = await this.payerModel
            .deleteOne({ _id: new Types.ObjectId(payerId), userId })
            .exec();
        if (result.deletedCount === 0) {
            throw this.notFound();
        }
    }

    /**
     * Видалення всіх платників користувача — частина остаточного видалення
     * акаунта. Список містить персональні дані третіх осіб, тож він мусить
     * зникати разом з акаунтом, а не залишатись сиротою у колекції.
     */
    async deleteAllForUser(userId: Types.ObjectId): Promise<number> {
        const result = await this.payerModel.deleteMany({ userId }).exec();
        return result.deletedCount ?? 0;
    }

    private notFound(): NotFoundException {
        return new NotFoundException({
            code: RESPONSE_CODE.PAYER_NOT_FOUND,
            message: 'Payer not found',
        });
    }
}
