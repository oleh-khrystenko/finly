import { createZodDto } from 'nestjs-zod';
import { ResetPasswordSchema } from '@finly/types';

export class ResetPasswordDto extends createZodDto(ResetPasswordSchema) {}
