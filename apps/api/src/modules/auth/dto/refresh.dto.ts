import { createZodDto } from 'nestjs-zod';
import { RefreshSchema } from '@neatslip/types';

export class RefreshDto extends createZodDto(RefreshSchema) {}
