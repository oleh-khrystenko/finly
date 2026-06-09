import { Module } from '@nestjs/common';

import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { HelpChatRateLimitGuard } from './guards/help-chat-rate-limit.guard';
import { AnthropicService } from './providers/anthropic.service';
import { aiProviderProvider } from './providers/ai-provider.provider';

@Module({
    controllers: [AiController],
    providers: [
        AiService,
        AnthropicService,
        aiProviderProvider,
        HelpChatRateLimitGuard,
    ],
})
export class AiModule {}
