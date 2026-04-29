import { createZodDto } from 'nestjs-zod';

import { UpdateLangSchema } from '@neatslip/types';

export class UpdateLangDto extends createZodDto(UpdateLangSchema) {}
