import { createZodDto } from 'nestjs-zod';

import { SpendExecutionsSchema } from '@neatslip/types';

export class SpendExecutionsDto extends createZodDto(SpendExecutionsSchema) {}
