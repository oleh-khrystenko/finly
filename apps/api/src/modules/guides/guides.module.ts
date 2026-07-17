import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { StorageModule } from '../storage/storage.module';
import { GoogleSearchConsoleClient } from './google-search-console.client';
import { GuideImagesService } from './guide-images.service';
import { GuidesAdminController } from './guides-admin.controller';
import { GuidesOrganicService } from './guides-organic.service';
import { GuidesPublicController } from './guides-public.controller';
import { GuidesRevalidationService } from './guides-revalidation.service';
import { GuidesService } from './guides.service';
import { Guide, GuideSchema } from './schemas/guide.schema';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Guide.name, schema: GuideSchema }]),
        StorageModule,
    ],
    controllers: [GuidesPublicController, GuidesAdminController],
    providers: [
        GuidesService,
        GuideImagesService,
        GuidesRevalidationService,
        GoogleSearchConsoleClient,
        GuidesOrganicService,
    ],
})
export class GuidesModule {}
