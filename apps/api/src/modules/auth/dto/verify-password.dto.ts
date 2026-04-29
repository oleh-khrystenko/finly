import { createZodDto } from 'nestjs-zod';
import { VerifyPasswordSchema } from '@neatslip/types';

export class VerifyPasswordDto extends createZodDto(VerifyPasswordSchema) {}
