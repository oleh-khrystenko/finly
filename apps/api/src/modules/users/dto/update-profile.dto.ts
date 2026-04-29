import { createZodDto } from 'nestjs-zod';
import { UpdateProfileSchema } from '@neatslip/types';

export class UpdateProfileDto extends createZodDto(UpdateProfileSchema) {}
