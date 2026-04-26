import { createZodDto } from 'nestjs-zod';
import { UpdateProfileSchema } from '@cyanship/types';

export class UpdateProfileDto extends createZodDto(UpdateProfileSchema) {}
