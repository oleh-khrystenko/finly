import { createZodDto } from 'nestjs-zod';

import { AcceptTermsSchema } from '@cyanship/types';

export class AcceptTermsDto extends createZodDto(AcceptTermsSchema) {}
