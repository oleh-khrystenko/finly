import { createZodDto } from 'nestjs-zod';
import { AiChatRequestSchema } from '@finly/types';

export class AiChatDto extends createZodDto(AiChatRequestSchema) {}
