import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { CloudflareR2Service } from './providers/cloudflare-r2.service';
import { storageProviderProvider } from './providers/storage-provider.provider';

@Module({
    imports: [UsersModule],
    controllers: [StorageController],
    providers: [StorageService, CloudflareR2Service, storageProviderProvider],
    exports: [StorageService],
})
export class StorageModule {}
