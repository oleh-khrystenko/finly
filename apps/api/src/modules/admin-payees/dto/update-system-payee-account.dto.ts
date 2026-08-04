import { createZodDto } from 'nestjs-zod';
import { UpdateSystemPayeeAccountSchema } from '@finly/types';

export class UpdateSystemPayeeAccountDto extends createZodDto(
    UpdateSystemPayeeAccountSchema
) {}
