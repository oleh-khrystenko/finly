import { createZodDto } from 'nestjs-zod';

import { UpdateLangSchema } from '@cyanship/types';

export class UpdateLangDto extends createZodDto(UpdateLangSchema) {}
