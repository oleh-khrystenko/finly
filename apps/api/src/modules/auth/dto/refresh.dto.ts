import { createZodDto } from 'nestjs-zod';
import { RefreshSchema } from '@cyanship/types';

export class RefreshDto extends createZodDto(RefreshSchema) {}
