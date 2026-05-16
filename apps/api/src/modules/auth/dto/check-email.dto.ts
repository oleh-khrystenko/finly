import { createZodDto } from 'nestjs-zod';
import { CheckEmailSchema } from '@finly/types';

export class CheckEmailDto extends createZodDto(CheckEmailSchema) {}
