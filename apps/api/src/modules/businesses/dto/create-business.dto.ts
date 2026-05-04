import { createZodDto } from 'nestjs-zod';
import { CreateBusinessSchema } from '@finly/types';

export class CreateBusinessDto extends createZodDto(CreateBusinessSchema) {}
