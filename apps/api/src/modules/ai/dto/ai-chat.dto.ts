import { createZodDto } from 'nestjs-zod';
import { AiChatRequestSchema } from '@cyanship/types';

export class AiChatDto extends createZodDto(AiChatRequestSchema) {}
