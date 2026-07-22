import { createZodDto } from 'nestjs-zod';
import { RejectPublicityRequestSchema } from '@finly/types';

export class RejectPublicityDto extends createZodDto(
    RejectPublicityRequestSchema
) {}
