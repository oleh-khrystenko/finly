import { createZodDto } from 'nestjs-zod';
import { LoginPasswordSchema } from '@cyanship/types';

export class LoginPasswordDto extends createZodDto(LoginPasswordSchema) {}
