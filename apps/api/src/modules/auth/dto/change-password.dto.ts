import { createZodDto } from 'nestjs-zod';
import { ChangePasswordSchema } from '@neatslip/types';

export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}
