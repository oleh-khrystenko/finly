import { Module } from '@nestjs/common';

import { StorageService } from './storage.service';
import { CloudflareR2Service } from './providers/cloudflare-r2.service';
import { storageProviderProvider } from './providers/storage-provider.provider';

/**
 * Sprint 13 §13 — кінцевий стан DI-графа: StorageModule autonomous, НЕ
 * імпортує UsersModule і не тримає avatar-controller. Avatar-домен (controller
 * + service) переїхав у `UsersModule`. Цикл Storage→Users→Auth→Storage, що
 * падав на docker dev `UndefinedModuleException`, розв'язано по-справжньому:
 * жоден `@Module` decorator більше не читає `UsersModule` immediate на
 * завантаженні StorageModule.
 */
@Module({
    providers: [StorageService, CloudflareR2Service, storageProviderProvider],
    exports: [StorageService],
})
export class StorageModule {}
