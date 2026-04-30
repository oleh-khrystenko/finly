import { createZodDto } from 'nestjs-zod';

import { SendMagicLinkSchema } from '@finly/types';

export class SendMagicLinkDto extends createZodDto(SendMagicLinkSchema) {}
