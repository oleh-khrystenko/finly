/**
 * One-shot dev-DB drop для Sprint 9 deploy-prep (rollout-нота README §Migrations).
 *
 * Призначення: повністю стерти `finly-dev` колекції перед першим запуском
 * Sprint 9+ коду. Старі документи (Business з `requisites`, Invoice без
 * `accountId`) несумісні з новою схемою, тому Sprint 9 README явно фіксує
 * dropDatabase замість міграцій.
 *
 * Safety-guards:
 *  - читає MONGODB_URI рівно з root `.env`;
 *  - блокується якщо у URI є substring `finly-prod`;
 *  - друкує preview database-name + collection list ПЕРЕД drop-ом.
 *
 * Run: `pnpm --filter api exec tsx scripts/drop-dev-db.ts`.
 */
import { config } from 'dotenv';
import mongoose from 'mongoose';
import * as path from 'node:path';

config({ path: path.resolve(__dirname, '../../../.env') });

const uri = process.env.MONGODB_URI;
if (!uri) {
    console.error('MONGODB_URI is missing from root .env — abort');
    process.exit(1);
}

if (uri.includes('finly-prod')) {
    console.error(
        'Refusing to drop: MONGODB_URI looks like production (substring "finly-prod"). Manual edit required.'
    );
    process.exit(2);
}

async function main(): Promise<void> {
    await mongoose.connect(uri!);
    const conn = mongoose.connection;
    const dbName = conn.name;
    const collections = await conn.db!.listCollections().toArray();
    console.log(`Connected to db="${dbName}", host="${conn.host}"`);
    console.log(
        `Collections (${collections.length}):`,
        collections.map((c) => c.name).join(', ') || '(empty)'
    );
    console.log('Dropping database...');
    await conn.dropDatabase();
    console.log('Drop OK.');
    await mongoose.disconnect();
}

void main().catch((err: unknown) => {
    console.error('drop-dev-db failed:', err);
    process.exit(1);
});
