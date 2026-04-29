import { createZodDto } from 'nestjs-zod';
import { AiChatRequestSchema } from '@neatslip/types';

export class AiChatDto extends createZodDto(AiChatRequestSchema) {}
