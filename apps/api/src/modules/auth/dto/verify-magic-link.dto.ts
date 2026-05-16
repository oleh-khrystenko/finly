import { createZodDto } from 'nestjs-zod';

import { VerifyMagicLinkSchema } from '@finly/types';

export class VerifyMagicLinkDto extends createZodDto(VerifyMagicLinkSchema) {}
