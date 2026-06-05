import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { UsersModule } from '../users/users.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiRateLimitGuard } from './guards/ai-rate-limit.guard';
import { HelpChatRateLimitGuard } from './guards/help-chat-rate-limit.guard';
import { AnthropicService } from './providers/anthropic.service';
import { aiProviderProvider } from './providers/ai-provider.provider';
import { ChatMessage, ChatMessageSchema } from './schemas/chat-message.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: ChatMessage.name, schema: ChatMessageSchema },
        ]),
        UsersModule,
    ],
    controllers: [AiController],
    providers: [
        AiService,
        AnthropicService,
        aiProviderProvider,
        AiRateLimitGuard,
        HelpChatRateLimitGuard,
    ],
})
export class AiModule {}
