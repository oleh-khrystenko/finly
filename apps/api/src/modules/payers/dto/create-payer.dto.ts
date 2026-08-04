import { createZodDto } from 'nestjs-zod';

import { CreatePayerSchema } from '@finly/types';

export class CreatePayerDto extends createZodDto(CreatePayerSchema) {}
