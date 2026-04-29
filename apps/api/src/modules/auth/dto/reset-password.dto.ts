import { createZodDto } from 'nestjs-zod';
import { ResetPasswordSchema } from '@neatslip/types';

export class ResetPasswordDto extends createZodDto(ResetPasswordSchema) {}
