import { createZodDto } from 'nestjs-zod';
import { CheckEmailSchema } from '@cyanship/types';

export class CheckEmailDto extends createZodDto(CheckEmailSchema) {}
