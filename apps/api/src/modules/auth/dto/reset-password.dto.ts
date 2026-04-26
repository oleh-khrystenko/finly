import { createZodDto } from 'nestjs-zod';
import { ResetPasswordSchema } from '@cyanship/types';

export class ResetPasswordDto extends createZodDto(ResetPasswordSchema) {}
