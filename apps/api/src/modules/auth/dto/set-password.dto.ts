import { createZodDto } from 'nestjs-zod';
import { SetPasswordSchema } from '@finly/types';

export class SetPasswordDto extends createZodDto(SetPasswordSchema) {}
