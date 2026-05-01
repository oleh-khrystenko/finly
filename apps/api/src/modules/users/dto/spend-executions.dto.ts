import { createZodDto } from 'nestjs-zod';

import { SpendExecutionsSchema } from '@finly/types';

export class SpendExecutionsDto extends createZodDto(SpendExecutionsSchema) {}
