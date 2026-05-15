import {
    Body,
    Controller,
    Delete,
    HttpCode,
    HttpStatus,
    Post,
    UseGuards,
} from '@nestjs/common';
import {
    RESPONSE_CODE,
    type AvatarUploadUrlResponse,
    type CommitAvatarUploadResponse,
    type ResponseCode,
} from '@finly/types';

import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AvatarService } from './avatar.service';
import { CommitAvatarUploadDto } from './dto/commit-avatar-upload.dto';
import { UserDocument } from './schemas/user.schema';

/**
 * Sprint 13 §13 — resident у `UsersModule` поруч з `AvatarService` і `User`-
 * model. URL prefix зберігається (`/storage/avatar/*`) — клієнти не зачепило.
 * До Sprint 13 controller жив у `StorageModule`; переїхав, щоб StorageModule
 * став autonomous (не імпортував UsersModule). Avatar-домен — частина User-а,
 * StorageService — лише транспорт.
 */
@Controller('storage')
@UseGuards(JwtActiveGuard)
export class AvatarController {
    constructor(private readonly avatarService: AvatarService) {}

    @Post('avatar/upload-url')
    async createAvatarUploadUrl(
        @CurrentUser() user: UserDocument
    ): Promise<{ data: AvatarUploadUrlResponse }> {
        const data = await this.avatarService.createAvatarUploadUrl(
            user._id.toString()
        );
        return { data };
    }

    @Post('avatar/commit')
    @HttpCode(HttpStatus.OK)
    async commitAvatarUpload(
        @CurrentUser() user: UserDocument,
        @Body() dto: CommitAvatarUploadDto
    ): Promise<{ data: CommitAvatarUploadResponse & { code: ResponseCode } }> {
        const avatar = await this.avatarService.commitAvatarUpload(
            user._id.toString(),
            dto.fileKey
        );
        return { data: { avatar, code: RESPONSE_CODE.AVATAR_UPDATED } };
    }

    @Delete('avatar')
    @HttpCode(HttpStatus.OK)
    async deleteAvatar(
        @CurrentUser() user: UserDocument
    ): Promise<{ data: { code: ResponseCode } }> {
        await this.avatarService.deleteAvatar(user._id.toString());
        return { data: { code: RESPONSE_CODE.AVATAR_DELETED } };
    }
}
