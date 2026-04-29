import { createZodDto } from 'nestjs-zod';

import { VerifyMagicLinkSchema } from '@neatslip/types';

export class VerifyMagicLinkDto extends createZodDto(VerifyMagicLinkSchema) {}
