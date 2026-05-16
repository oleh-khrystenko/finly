import { Module } from '@nestjs/common';

import { BusinessesModule } from '../businesses/businesses.module';
import { UsersModule } from '../users/users.module';
import { OrphanProfileCleanupService } from './orphan-profile-cleanup.service';

/**
 * Sprint 12 §12.1c — окремий module для cron, що cascade-видаляє orphan-Business
 * у користувачів з incomplete-profile. Separation of concerns симетричне
 * `LandingClaimModule` (Sprint 10): cross-cutting service, що тягне і
 * UsersModule (stamps + clear pendingPostLoginTarget), і BusinessesModule
 * (cascade-delete). Розміщення поза UsersModule зберігає one-way DAG
 * `Users ← Businesses ← Accounts ← Invoices` (CLAUDE.md Module Dependency Map).
 *
 * EmailService інжектиться напряму — `EmailModule` @Global, без явного імпорту.
 */
@Module({
    imports: [UsersModule, BusinessesModule],
    providers: [OrphanProfileCleanupService],
})
export class OrphanCleanupModule {}
