import { createZodDto } from 'nestjs-zod';
import { RefreshSchema } from '@finly/types';

export class RefreshDto extends createZodDto(RefreshSchema) {}
