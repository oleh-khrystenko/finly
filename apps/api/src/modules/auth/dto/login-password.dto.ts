import { createZodDto } from 'nestjs-zod';
import { LoginPasswordSchema } from '@neatslip/types';

export class LoginPasswordDto extends createZodDto(LoginPasswordSchema) {}
