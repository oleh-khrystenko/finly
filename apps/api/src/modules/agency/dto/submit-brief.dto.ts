import { createZodDto } from 'nestjs-zod';
import { SubmitBriefSchema } from '@cyanship/types';

export class SubmitBriefDto extends createZodDto(SubmitBriefSchema) {}
