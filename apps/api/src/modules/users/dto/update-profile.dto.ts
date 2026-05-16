import { createZodDto } from 'nestjs-zod';
import { UpdateProfileSchema } from '@finly/types';

export class UpdateProfileDto extends createZodDto(UpdateProfileSchema) {}
