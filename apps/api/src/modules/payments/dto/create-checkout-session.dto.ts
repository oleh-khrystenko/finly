import { createZodDto } from 'nestjs-zod';
import { CreateCheckoutSessionSchema } from '@finly/types';

export class CreateCheckoutSessionDto extends createZodDto(
    CreateCheckoutSessionSchema
) {}
