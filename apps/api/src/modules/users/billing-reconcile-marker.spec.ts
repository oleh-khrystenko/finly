import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { Model } from 'mongoose';

import {
    createStandaloneMongo,
    type InMemoryMongo,
} from '../../test-utils/mongo';
import {
    ExecutionTransaction,
    ExecutionTransactionSchema,
} from './schemas/execution-transaction.schema';
import { User, UserDocument, UserSchema } from './schemas/user.schema';
import { UsersService } from './users.service';

/**
 * Sprint 19 — durable-маркер реконсиляції (`billing.reconcileRequiredAt`)
 * на РЕАЛЬНОМУ Mongo. Семантика умовного clear-у (`$lte: notAfter`) і no-op
 * крізь null-білінг — це Mongo-фільтри, а не JS-логіка: mock-based специ
 * (`reconciliation.service.spec`) перевіряють лише факт виклику, дрейф самих
 * фільтрів ловиться тільки тут. На цих фільтрах тримається гарантія
 * «відкладений reconcile не губиться» (конкурентний стемп переживає clear).
 */
describe('UsersService — billing reconcile marker (in-memory Mongo)', () => {
    let mongo: InMemoryMongo;
    let moduleRef: TestingModule;
    let service: UsersService;
    let userModel: Model<UserDocument>;

    beforeAll(async () => {
        mongo = await createStandaloneMongo();
        moduleRef = await Test.createTestingModule({
            imports: [
                MongooseModule.forRoot(mongo.uri),
                MongooseModule.forFeature([
                    { name: User.name, schema: UserSchema },
                    {
                        name: ExecutionTransaction.name,
                        schema: ExecutionTransactionSchema,
                    },
                ]),
            ],
            providers: [UsersService],
        }).compile();

        service = moduleRef.get(UsersService);
        userModel = moduleRef.get(getModelToken(User.name));
    }, 30_000);

    afterAll(async () => {
        await moduleRef.close();
        await mongo.stop();
    });

    afterEach(async () => {
        await userModel.deleteMany({});
    });

    async function createUser(
        billing: Partial<NonNullable<UserDocument['billing']>> | null
    ): Promise<UserDocument> {
        return userModel.create({
            email: `u${Math.random().toString(36).slice(2)}@test.dev`,
            profile: {},
            executions: { balance: 0, freeReportUsed: false },
            billing:
                billing === null
                    ? null
                    : {
                          provider: 'monobank',
                          cardToken: null,
                          walletId: null,
                          cardMask: null,
                          planCode: null,
                          currency: 'UAH',
                          subscriptionStatus: null,
                          currentPeriodEnd: null,
                          nextChargeAt: null,
                          cancelAtPeriodEnd: false,
                          hasActiveSubscription: false,
                          lastProviderEventAt: null,
                          dunningAttempts: 0,
                          nextRetryAt: null,
                          oneOffLevel: null,
                          oneOffAccessUntil: null,
                          oneOffOrderReference: null,
                          reconcileRequiredAt: null,
                          ...billing,
                      },
        });
    }

    async function markerOf(userId: string): Promise<Date | null> {
        const doc = await userModel.findById(userId).lean();
        return doc?.billing?.reconcileRequiredAt ?? null;
    }

    it('stamp ставить маркер користувачу з білінг-субдоком', async () => {
        const user = await createUser({});
        await service.stampBillingReconcileRequired(user._id.toString());
        expect(await markerOf(user._id.toString())).toBeInstanceOf(Date);
    });

    it('stamp крізь null-білінг — no-op без помилки ($set не падає на guard-і)', async () => {
        const user = await createUser(null);
        await expect(
            service.stampBillingReconcileRequired(user._id.toString())
        ).resolves.toBeUndefined();
        const doc = await userModel.findById(user._id).lean();
        expect(doc!.billing).toBeNull();
    });

    it('clear знімає маркер, що не новіший за notAfter', async () => {
        const stampedAt = new Date(Date.now() - 60_000);
        const user = await createUser({ reconcileRequiredAt: stampedAt });

        await service.clearBillingReconcileRequired(
            user._id.toString(),
            new Date() // старт прогону пізніший за стемп
        );

        expect(await markerOf(user._id.toString())).toBeNull();
    });

    it('конкурентний стемп ПІСЛЯ старту прогону переживає clear ($lte-межа)', async () => {
        const runStartedAt = new Date(Date.now() - 60_000);
        // Cron-флип приземлився після того, як reconcile прочитав білінг-стан:
        // маркер новіший за notAfter — безумовний clear загубив би єдиний
        // durable-тригер того флипу.
        const concurrentStamp = new Date();
        const user = await createUser({
            reconcileRequiredAt: concurrentStamp,
        });

        await service.clearBillingReconcileRequired(
            user._id.toString(),
            runStartedAt
        );

        const survived = await markerOf(user._id.toString());
        expect(survived).toBeInstanceOf(Date);
        expect(survived!.getTime()).toBe(concurrentStamp.getTime());
    });

    it('clear на null-маркері / null-білінгу — idempotent no-op', async () => {
        const noMarker = await createUser({});
        const noBilling = await createUser(null);

        await expect(
            service.clearBillingReconcileRequired(
                noMarker._id.toString(),
                new Date()
            )
        ).resolves.toBeUndefined();
        await expect(
            service.clearBillingReconcileRequired(
                noBilling._id.toString(),
                new Date()
            )
        ).resolves.toBeUndefined();

        expect(await markerOf(noMarker._id.toString())).toBeNull();
        const doc = await userModel.findById(noBilling._id).lean();
        expect(doc!.billing).toBeNull();
    });
});
