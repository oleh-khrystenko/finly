import { createZodDto } from 'nestjs-zod';
import { VerifyPasswordSchema } from '@finly/types';

export class VerifyPasswordDto extends createZodDto(VerifyPasswordSchema) {}
