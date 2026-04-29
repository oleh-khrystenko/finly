import { createZodDto } from 'nestjs-zod';
import { CheckEmailSchema } from '@neatslip/types';

export class CheckEmailDto extends createZodDto(CheckEmailSchema) {}
