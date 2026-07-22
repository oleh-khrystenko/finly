import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { AdminPayeesController } from './admin-payees.controller';
import { AdminPublicityController } from './admin-publicity.controller';

/**
 * Sprint 29 — адмін-поверхня системних отримувачів. Імпортує обидва домени
 * (`BusinessesModule` + `AccountsModule`), бо контролер створює і отримувача
 * (Business), і його реквізити (Account), переюзуючи наявні сервіси. Дзеркалить
 * композицію `LandingClaimModule`, який так само стоїть над обома доменами і не
 * порушує one-way DAG (`Users ← Businesses ← Accounts`).
 */
@Module({
    imports: [BusinessesModule, AccountsModule],
    controllers: [AdminPayeesController, AdminPublicityController],
})
export class AdminPayeesModule {}
