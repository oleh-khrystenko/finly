import { createZodDto } from 'nestjs-zod';
import { SetPasswordSchema } from '@neatslip/types';

export class SetPasswordDto extends createZodDto(SetPasswordSchema) {}
