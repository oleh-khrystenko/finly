import { createZodDto } from 'nestjs-zod';

import { SpendExecutionsSchema } from '@cyanship/types';

export class SpendExecutionsDto extends createZodDto(SpendExecutionsSchema) {}
