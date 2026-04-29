import { createZodDto } from 'nestjs-zod';
import { CommitAvatarUploadSchema } from '@neatslip/types';

export class CommitAvatarUploadDto extends createZodDto(
    CommitAvatarUploadSchema
) {}
