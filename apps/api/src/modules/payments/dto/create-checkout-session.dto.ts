import { createZodDto } from 'nestjs-zod';
import { CreateCheckoutSessionSchema } from '@cyanship/types';

export class CreateCheckoutSessionDto extends createZodDto(
    CreateCheckoutSessionSchema
) {}
