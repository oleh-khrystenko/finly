import { createZodDto } from 'nestjs-zod';
import { ChangePasswordSchema } from '@finly/types';

export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}
