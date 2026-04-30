import { createZodDto } from 'nestjs-zod';

import { AcceptTermsSchema } from '@finly/types';

export class AcceptTermsDto extends createZodDto(AcceptTermsSchema) {}
