import { createZodDto } from 'nestjs-zod';

import { AcceptTermsSchema } from '@neatslip/types';

export class AcceptTermsDto extends createZodDto(AcceptTermsSchema) {}
