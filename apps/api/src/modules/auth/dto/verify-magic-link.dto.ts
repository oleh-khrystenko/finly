import { createZodDto } from 'nestjs-zod';

import { VerifyMagicLinkSchema } from '@cyanship/types';

export class VerifyMagicLinkDto extends createZodDto(VerifyMagicLinkSchema) {}
