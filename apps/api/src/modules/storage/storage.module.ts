import { forwardRef, Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { CloudflareR2Service } from './providers/cloudflare-r2.service';
import { storageProviderProvider } from './providers/storage-provider.provider';

// Cycle: Storage → Users → Auth(forwardRef) → Storage. UsersModule.imports вже
// має forwardRef(() => AuthModule) на Nest scanner-рівні, але на CJS-evaluation-
// рівні decorator @Module тут читає `users_module_1.UsersModule` immediate. У
// trace `app → accounts → businesses → users → auth → storage` users.module.ts
// ще in-stack і не дійшла до своєї class declaration → UsersModule = undefined
// → metadata.imports[0] = undefined → UndefinedModuleException. forwardRef тут
// закриває другу ланку циклу: функція delegate'ить evaluation до моменту коли
// Nest scanner викличе її, до того часу UsersModule повністю exported.
@Module({
    imports: [forwardRef(() => UsersModule)],
    controllers: [StorageController],
    providers: [StorageService, CloudflareR2Service, storageProviderProvider],
    exports: [StorageService],
})
export class StorageModule {}
