import { createZodDto } from 'nestjs-zod';
import { UpdateBusinessSchema } from '@finly/types';

export class UpdateBusinessDto extends createZodDto(UpdateBusinessSchema) {}
