import { createZodDto } from 'nestjs-zod';
import { CreateAccountSchema } from '@finly/types';

export class CreateAccountDto extends createZodDto(CreateAccountSchema) {}
