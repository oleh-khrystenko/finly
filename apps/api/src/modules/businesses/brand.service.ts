import { randomUUID } from 'crypto';

import {
    BadRequestException,
    HttpException,
    Injectable,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- ts-jest default-import interop bug з sharp (див. qr-logo.compositor.ts)
import sharp = require('sharp');
import {
    BRAND_COMMIT_OUTCOME,
    BRAND_LOGO,
    BRAND_LOGO_FILE_KEY_REGEX,
    NBU_HOST_PRIMARY,
    RESPONSE_CODE,
    isAccessLevelAtLeast,
    type AccessLevel,
    type BrandLogoUploadUrlResponse,
    type BrandPreviewResponse,
    type BusinessBrand,
    type CommitBrandResponse,
} from '@finly/types';

import { ENV } from '../../config/env';
import { QrService } from '../qr/qr.service';
import { QrBrandMarkBaker } from '../qr/renderers/qr-brand-mark.baker';
import { StorageService } from '../storage/storage.service';
import {
    Account,
    type AccountDocument,
} from '../accounts/schemas/account.schema';
import { Business, type BusinessDocument } from './schemas/business.schema';

/**
 * Поріг «майже білий» (Sprint 21, ризик з плану — підбирається емпірично).
 * Перевіряємо НАЙТЕМНІШИЙ піксель після flatten на білий: якщо навіть він
 * світліший за поріг, у логотипі немає достатньо темного контенту й він зникне
 * на білій плашці. 0..255; вище → відхиляємо.
 */
const ALMOST_WHITE_MIN_DARKNESS = 200;

const EXTENSION_BY_MIME: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
};

/**
 * Sprint 21 — домен кастомного бренду отримувача. Дзеркало avatar-pipeline
 * (presigned → commit з HeadObject-валідацією), плюс bake-on-commit двох
 * бренд-марок (`QrBrandMarkBaker`) і запис у Business-субдок `brand`.
 *
 * Гейтинг — М'ЯКИЙ: commit нижче brand зберігає лого у `pending`-слот і повертає
 * пейвол-стан у УСПІШНІЙ відповіді (не throw), дзеркало slug-upsell. Усі файли
 * (оригінал + дві марки) живуть під namespace `brand-logos/{businessId}/`.
 */
@Injectable()
export class BrandService {
    private readonly logger = new Logger(BrandService.name);

    constructor(
        @InjectModel(Business.name)
        private readonly businessModel: Model<BusinessDocument>,
        @InjectModel(Account.name)
        private readonly accountModel: Model<AccountDocument>,
        private readonly storage: StorageService,
        private readonly baker: QrBrandMarkBaker,
        private readonly qrService: QrService
    ) {}

    async createUploadUrl(
        businessId: string,
        contentType: string
    ): Promise<BrandLogoUploadUrlResponse> {
        const extension = EXTENSION_BY_MIME[contentType];
        if (!extension) {
            // DTO-enum уже звужує contentType; цей guard — defense-in-depth.
            throw new BadRequestException({
                code: RESPONSE_CODE.BRAND_LOGO_INVALID,
                message: 'Unsupported content type',
            });
        }
        const fileKey = `brand-logos/${businessId}/${randomUUID()}.${extension}`;
        const { uploadUrl } = await this.mapStorageError(
            () =>
                this.storage.createPresignedUploadUrl({
                    key: fileKey,
                    contentType,
                }),
            'presign brand logo upload'
        );
        return { uploadUrl, fileKey };
    }

    async commit(
        business: BusinessDocument,
        fileKey: string,
        displayName: string | null,
        actorLevel: AccessLevel
    ): Promise<CommitBrandResponse> {
        const businessId = business._id.toString();
        const logo = await this.loadAndValidateLogo(businessId, fileKey);
        const marks = await this.bakeMarks(logo, displayName);

        const uuid = this.uuidOfKey(fileKey);
        const centerKey = `brand-logos/${businessId}/${uuid}-center.png`;
        const bandKey = `brand-logos/${businessId}/${uuid}-band.png`;
        await this.mapStorageError(
            () =>
                Promise.all([
                    this.storage.uploadBuffer({
                        key: centerKey,
                        buffer: marks.centerMark,
                        contentType: 'image/png',
                    }),
                    this.storage.uploadBuffer({
                        key: bandKey,
                        buffer: marks.bandMark,
                        contentType: 'image/png',
                    }),
                ]),
            'upload brand marks'
        );

        const slot = {
            logoUrl: this.storage.buildPublicUrl(fileKey),
            centerMarkUrl: this.storage.buildPublicUrl(centerKey),
            bandMarkUrl: this.storage.buildPublicUrl(bandKey),
            displayName,
        };

        const isPaid = isAccessLevelAtLeast(actorLevel, 'brand');
        const previous = business.brand;
        const newBrand: BusinessBrand = isPaid
            ? { active: slot, pending: null }
            : {
                  active: previous?.active ?? null,
                  pending: { ...slot, uploadedAt: new Date() },
              };

        await this.businessModel
            .findByIdAndUpdate(business._id, { brand: newBrand })
            .exec();

        // Видаляємо файли, що більше не на жодному слоті (best-effort, ПІСЛЯ
        // успішного persist — щоб збій persist не лишив слот без файлів).
        await this.deleteOrphanedFiles(previous, newBrand);

        return {
            outcome: isPaid
                ? BRAND_COMMIT_OUTCOME.ACTIVE
                : BRAND_COMMIT_OUTCOME.PENDING,
            brand: newBrand,
        };
    }

    async delete(business: BusinessDocument): Promise<void> {
        const previous = business.brand;
        await this.businessModel
            .findByIdAndUpdate(business._id, { brand: null })
            .exec();
        await this.deleteSlotFiles(previous?.active);
        await this.deleteSlotFiles(previous?.pending);
    }

    async preview(
        business: BusinessDocument,
        fileKey: string,
        displayName: string | null
    ): Promise<BrandPreviewResponse> {
        const logo = await this.loadAndValidateLogo(
            business._id.toString(),
            fileKey
        );
        const marks = await this.bakeMarks(logo, displayName);

        const pageUrl = `${ENV.PAY_PUBLIC_URL.replace(/\/$/, '')}/${business.slug}`;
        const pagePng = await this.qrService.renderForUrl(pageUrl, {
            centerMark: marks.centerMark,
        });

        const account = await this.accountModel
            .findOne({ businessId: business._id })
            .sort({ createdAt: 1 })
            .exec();

        let nbuPngBase64: string | null = null;
        if (account) {
            const nbuPng = await this.qrService.renderForNbuPayload(
                {
                    receiverName: business.name,
                    iban: account.iban,
                    receiverTaxId: business.taxId,
                    amountKopecks: null,
                    purpose: business.paymentPurposeTemplate,
                },
                '003',
                { host: NBU_HOST_PRIMARY, topBandMark: marks.bandMark }
            );
            nbuPngBase64 = nbuPng.toString('base64');
        }

        return {
            pagePngBase64: pagePng.toString('base64'),
            nbuPngBase64,
        };
    }

    /**
     * Валідує namespace/наявність/тип/вагу/аспект/«майже білий» і повертає байти
     * логотипа. Невалідний presigned-файл best-effort прибирається з R2 (інакше
     * HeadObject-enforcement безпредметний). Усі помилки — explicit 4xx з кодом.
     */
    private async loadAndValidateLogo(
        businessId: string,
        fileKey: string
    ): Promise<Buffer> {
        if (
            !BRAND_LOGO_FILE_KEY_REGEX.test(fileKey) ||
            !fileKey.startsWith(`brand-logos/${businessId}/`)
        ) {
            throw new BadRequestException({
                code: RESPONSE_CODE.BRAND_LOGO_FILE_KEY_INVALID,
                message: 'File key invalid or outside business namespace',
            });
        }

        const metadata = await this.mapStorageError(
            () => this.storage.getObjectMetadata(fileKey),
            'read brand logo metadata'
        );
        if (!metadata.exists) {
            throw new BadRequestException({
                code: RESPONSE_CODE.BRAND_LOGO_UPLOAD_NOT_FOUND,
                message: 'Uploaded logo not found',
            });
        }
        const allowedMimes: readonly string[] = BRAND_LOGO.ALLOWED_MIME_TYPES;
        if (
            !allowedMimes.includes(metadata.contentType) ||
            metadata.contentLength > BRAND_LOGO.MAX_FILE_SIZE
        ) {
            await this.storage.safeDeleteByKey(fileKey);
            throw new BadRequestException({
                code: RESPONSE_CODE.BRAND_LOGO_INVALID,
                message: 'Uploaded logo has invalid type or size',
            });
        }

        const logo = await this.mapStorageError(
            () => this.storage.downloadObject(fileKey),
            'download brand logo'
        );
        await this.assertValidImage(logo, fileKey);
        return logo;
    }

    /** Аспект (width ≥ height) + блок «майже білий». Кидає 4xx з кодом. */
    private async assertValidImage(
        logo: Buffer,
        fileKey: string
    ): Promise<void> {
        let width: number | undefined;
        let height: number | undefined;
        let minDarkness: number;
        try {
            const meta = await sharp(logo).metadata();
            width = meta.width;
            height = meta.height;
            const stats = await sharp(logo)
                .flatten({ background: '#ffffff' })
                .greyscale()
                .stats();
            minDarkness = stats.channels[0].min;
        } catch (cause) {
            await this.storage.safeDeleteByKey(fileKey);
            throw new BadRequestException({
                code: RESPONSE_CODE.BRAND_LOGO_INVALID,
                message:
                    cause instanceof Error ? cause.message : 'Unreadable image',
            });
        }

        if (!width || !height) {
            await this.storage.safeDeleteByKey(fileKey);
            throw new BadRequestException({
                code: RESPONSE_CODE.BRAND_LOGO_INVALID,
                message: 'Image has no dimensions',
            });
        }
        if (height > width) {
            await this.storage.safeDeleteByKey(fileKey);
            throw new BadRequestException({
                code: RESPONSE_CODE.BRAND_LOGO_ASPECT_INVALID,
                message: 'Vertical images are not allowed',
            });
        }
        if (minDarkness > ALMOST_WHITE_MIN_DARKNESS) {
            await this.storage.safeDeleteByKey(fileKey);
            throw new BadRequestException({
                code: RESPONSE_CODE.BRAND_LOGO_TOO_LIGHT,
                message: 'Logo is too light and would vanish on white',
            });
        }
    }

    private async bakeMarks(
        logo: Buffer,
        displayName: string | null
    ): Promise<{ centerMark: Buffer; bandMark: Buffer }> {
        return this.mapStorageError(
            () => this.baker.bake(logo, displayName),
            'bake brand marks'
        );
    }

    /** UUID-сегмент file-key (regex уже гарантує формат). */
    private uuidOfKey(fileKey: string): string {
        const fileName = fileKey.split('/').pop() ?? '';
        return fileName.replace(/\.(png|jpe?g|webp)$/, '');
    }

    /** Видаляє файли слотів попереднього стану, яких немає у новому. */
    private async deleteOrphanedFiles(
        previous: BusinessBrand | null,
        next: BusinessBrand
    ): Promise<void> {
        const kept = new Set(
            [next.active, next.pending].flatMap((s) =>
                s ? [s.logoUrl, s.centerMarkUrl, s.bandMarkUrl] : []
            )
        );
        const previousUrls = [previous?.active, previous?.pending].flatMap(
            (s) => (s ? [s.logoUrl, s.centerMarkUrl, s.bandMarkUrl] : [])
        );
        for (const url of previousUrls) {
            if (!kept.has(url)) {
                await this.storage.safeDeleteByUrl(url);
            }
        }
    }

    private async deleteSlotFiles(
        slot:
            | { logoUrl: string; centerMarkUrl: string; bandMarkUrl: string }
            | null
            | undefined
    ): Promise<void> {
        if (!slot) return;
        await this.storage.safeDeleteByUrl(slot.logoUrl);
        await this.storage.safeDeleteByUrl(slot.centerMarkUrl);
        await this.storage.safeDeleteByUrl(slot.bandMarkUrl);
    }

    /**
     * Обгортає сторонні ops (storage / sharp / bake) у нейтральний
     * `BRAND_LOGO_UPLOAD_FAILED` 5xx. Структуровані `HttpException` (наші 4xx з
     * кодом) проходять без зміни.
     */
    private async mapStorageError<T>(
        op: () => Promise<T>,
        label: string
    ): Promise<T> {
        try {
            return await op();
        } catch (err) {
            if (err instanceof HttpException) {
                throw err;
            }
            const error = err as Error;
            this.logger.error(
                `Brand storage operation failed (${label}): ${error.message}`,
                error.stack
            );
            throw new InternalServerErrorException({
                code: RESPONSE_CODE.BRAND_LOGO_UPLOAD_FAILED,
                message: `Brand ${label} failed`,
            });
        }
    }
}
