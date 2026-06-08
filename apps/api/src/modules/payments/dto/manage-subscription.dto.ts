import { createZodDto } from 'nestjs-zod';
import {
    CancelSubscriptionSchema,
    ChangePlanSchema,
    UpdateCardSchema,
} from '@finly/types';

export class CancelSubscriptionDto extends createZodDto(
    CancelSubscriptionSchema
) {}

export class ChangePlanDto extends createZodDto(ChangePlanSchema) {}

export class UpdateCardDto extends createZodDto(UpdateCardSchema) {}
