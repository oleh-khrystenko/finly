import { createZodDto } from 'nestjs-zod';
import { ChangePasswordSchema } from '@cyanship/types';

export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}
