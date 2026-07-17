import { createZodDto } from 'nestjs-zod';
import { CommitGuideImageSchema } from '@finly/types';

export class CommitGuideImageDto extends createZodDto(CommitGuideImageSchema) {}
