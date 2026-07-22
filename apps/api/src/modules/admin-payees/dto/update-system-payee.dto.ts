import { createZodDto } from 'nestjs-zod';
import { UpdateSystemPayeeSchema } from '@finly/types';

export class UpdateSystemPayeeDto extends createZodDto(
    UpdateSystemPayeeSchema
) {}
