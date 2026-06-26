import { createZodDto } from 'nestjs-zod';
import { ResumeSubscriptionSchema } from '@finly/types';

export class ResumeSubscriptionDto extends createZodDto(
    ResumeSubscriptionSchema
) {}
