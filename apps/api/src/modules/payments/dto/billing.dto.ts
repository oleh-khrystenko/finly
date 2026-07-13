import { createZodDto } from 'nestjs-zod';
import {
    BuyCreditsSchema,
    ChangeCapacitySchema,
    ManageAttachmentSchema,
    PriceCalculatorSchema,
    ResumeSubscriptionSchema,
    StartCheckoutSchema,
} from '@finly/types';

export class StartCheckoutDto extends createZodDto(StartCheckoutSchema) {}
export class ChangeCapacityDto extends createZodDto(ChangeCapacitySchema) {}
export class ManageAttachmentDto extends createZodDto(ManageAttachmentSchema) {}
export class BuyCreditsDto extends createZodDto(BuyCreditsSchema) {}
export class PriceCalculatorDto extends createZodDto(PriceCalculatorSchema) {}
export class ResumeSubscriptionDto extends createZodDto(
    ResumeSubscriptionSchema
) {}
