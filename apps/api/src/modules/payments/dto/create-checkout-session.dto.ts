import { createZodDto } from 'nestjs-zod';
import { CreateCheckoutSessionSchema } from '@neatslip/types';

export class CreateCheckoutSessionDto extends createZodDto(
    CreateCheckoutSessionSchema
) {}
