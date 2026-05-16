import { createZodDto } from 'nestjs-zod';
import { UpdateAccountSchema } from '@finly/types';

export class UpdateAccountDto extends createZodDto(UpdateAccountSchema) {}
