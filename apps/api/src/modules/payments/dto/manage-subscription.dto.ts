import { createZodDto } from 'nestjs-zod';
import {
    CancelSubscriptionSchema,
    ChangePlanSchema,
} from '@finly/types';

export class CancelSubscriptionDto extends createZodDto(
    CancelSubscriptionSchema
) {}

export class ChangePlanDto extends createZodDto(ChangePlanSchema) {}
