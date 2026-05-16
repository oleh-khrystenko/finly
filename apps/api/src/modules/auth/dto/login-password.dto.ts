import { createZodDto } from 'nestjs-zod';
import { LoginPasswordSchema } from '@finly/types';

export class LoginPasswordDto extends createZodDto(LoginPasswordSchema) {}
