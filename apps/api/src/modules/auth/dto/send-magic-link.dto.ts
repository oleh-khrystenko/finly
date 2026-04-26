import { createZodDto } from 'nestjs-zod';

import { SendMagicLinkSchema } from '@cyanship/types';

export class SendMagicLinkDto extends createZodDto(SendMagicLinkSchema) {}
