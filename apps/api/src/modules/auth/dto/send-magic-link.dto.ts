import { createZodDto } from 'nestjs-zod';

import { SendMagicLinkSchema } from '@neatslip/types';

export class SendMagicLinkDto extends createZodDto(SendMagicLinkSchema) {}
