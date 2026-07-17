import { createZodDto } from 'nestjs-zod';
import { ReorderGuidesSchema } from '@finly/types';

export class ReorderGuidesDto extends createZodDto(ReorderGuidesSchema) {}
