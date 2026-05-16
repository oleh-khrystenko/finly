import { createZodDto } from 'nestjs-zod';
import { CommitAvatarUploadSchema } from '@finly/types';

export class CommitAvatarUploadDto extends createZodDto(
    CommitAvatarUploadSchema
) {}
