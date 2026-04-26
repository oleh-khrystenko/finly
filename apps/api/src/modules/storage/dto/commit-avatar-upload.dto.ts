import { createZodDto } from 'nestjs-zod';
import { CommitAvatarUploadSchema } from '@cyanship/types';

export class CommitAvatarUploadDto extends createZodDto(
    CommitAvatarUploadSchema
) {}
