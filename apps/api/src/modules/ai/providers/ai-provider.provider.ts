import { Provider } from '@nestjs/common';

import { AI_PROVIDER } from '../interfaces/ai-provider.interface';
import { AnthropicService } from './anthropic.service';

export const aiProviderProvider: Provider = {
    provide: AI_PROVIDER,
    useClass: AnthropicService,
};
