import { createZodDto } from 'nestjs-zod';
import { UpsertGuideSchema } from '@finly/types';

export class UpsertGuideDto extends createZodDto(UpsertGuideSchema) {}
