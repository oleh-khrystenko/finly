import { createZodDto } from 'nestjs-zod';
import { CreateSystemPayeeAccountSchema } from '@finly/types';

export class CreateSystemPayeeAccountDto extends createZodDto(
    CreateSystemPayeeAccountSchema
) {}
