import { createZodDto } from 'nestjs-zod';

import { UpdatePayerSchema } from '@finly/types';

export class UpdatePayerDto extends createZodDto(UpdatePayerSchema) {}
