import { createZodDto } from 'nestjs-zod';
import { HelpChatRequestSchema } from '@finly/types';

export class HelpChatDto extends createZodDto(HelpChatRequestSchema) {}
