import { createZodDto } from 'nestjs-zod';
import { SetCatalogVisibilitySchema } from '@finly/types';

export class SetCatalogVisibilityDto extends createZodDto(
    SetCatalogVisibilitySchema
) {}
