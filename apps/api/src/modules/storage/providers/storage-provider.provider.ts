import { Provider } from '@nestjs/common';

import { STORAGE_PROVIDER } from '../interfaces/storage-provider.interface';
import { CloudflareR2Service } from './cloudflare-r2.service';

export const storageProviderProvider: Provider = {
    provide: STORAGE_PROVIDER,
    useClass: CloudflareR2Service,
};
