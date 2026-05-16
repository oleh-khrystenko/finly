import { createZodDto } from 'nestjs-zod';
import { QrPreviewInputSchema } from '@finly/types';

export class QrPreviewDto extends createZodDto(QrPreviewInputSchema) {}
