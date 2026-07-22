import { createZodDto } from 'nestjs-zod';
import { ApprovePublicityRequestSchema } from '@finly/types';

export class ApprovePublicityDto extends createZodDto(
    ApprovePublicityRequestSchema
) {}
