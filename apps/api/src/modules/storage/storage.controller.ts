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
import { AvatarService } from '../users/avatar.service';
import { UserDocument } from '../users/schemas/user.schema';
import { CommitAvatarUploadDto } from './dto/commit-avatar-upload.dto';

@Controller('storage')
@UseGuards(JwtActiveGuard)
export class StorageController {
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
