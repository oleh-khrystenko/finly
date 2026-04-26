import { createZodDto } from 'nestjs-zod';
import { SetPasswordSchema } from '@cyanship/types';

export class SetPasswordDto extends createZodDto(SetPasswordSchema) {}
