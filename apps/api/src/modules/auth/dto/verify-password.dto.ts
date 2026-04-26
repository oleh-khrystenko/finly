import { createZodDto } from 'nestjs-zod';
import { VerifyPasswordSchema } from '@cyanship/types';

export class VerifyPasswordDto extends createZodDto(VerifyPasswordSchema) {}
