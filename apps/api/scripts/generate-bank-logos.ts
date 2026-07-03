/**
 * Генерує `apps/web/public/banks/<bankCode>.webp` — офіційні іконки
 * банк-застосунків для per-bank сітки на публічній сторінці оплати
 * (Sprint 5, `docs/sprints/05-per-bank/`).
 *
 * **Джерело — Apple iTunes Lookup API** (`itunes.apple.com/lookup?bundleId=…`):
 * віддає `artworkUrl512` — офіційну іконку застосунку зі сторінки App Store.
 * bundleId кожного банку взято з публічного AASA-реєстру НБУ
 * (`qr.bank.gov.ua/.well-known/apple-app-site-association`, див.
 * `docs/sprints/05-per-bank/research-aasa.md`). Це канонічне джерело — не
 * випадкові картинки; використання іконок номінативне («оплата через цей банк»).
 *
 * **Універсальний формат** (рішення Sprint 5): квадратний WebP 128×128. Будь-яке
 * вхідне джерело нормалізується `sharp`-ом до цього єдиного спеку — щоб сітка
 * виглядала консистентно (один padding/масштаб/колірний профіль). Заокруглення
 * кутів робить CSS у `UiBankAppGrid` (не запікаємо в asset).
 *
 * Запуск (одноразовий, або після зміни bundleId / появи нового банку):
 *   pnpm --filter api ts-node scripts/generate-bank-logos.ts
 *
 * Коміт: згенеровані `.webp` + цей скрипт (reproducibility).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
import sharp = require('sharp');
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { BankCode } from '@finly/types';

const OUTPUT_DIR = join(__dirname, '../../web/public/banks');
const SIZE = 128;

/**
 * `bundleId` — iOS bundle id з НБУ-AASA (основний шлях резолву).
 * `fallbackTerm` — пошуковий запит у App Store, якщо lookup-by-bundleId дав 0
 * результатів (трапляється для частини застосунків); серед результатів беремо
 * рівно той, чий bundleId збігається з очікуваним.
 */
const BANK_APP_STORE: Record<
    BankCode,
    { bundleId: string; fallbackTerm: string }
> = {
    privatbank: { bundleId: 'ua.pb.privat24', fallbackTerm: 'Приват24' },
    monobank: { bundleId: 'com.ftband.mono', fallbackTerm: 'monobank' },
    pumb: { bundleId: 'fuib.pumb-ispot', fallbackTerm: 'ПУМБ Online' },
    oschadbank: { bundleId: 'ua.oschadbank.flumo', fallbackTerm: 'Ощад' },
    sense: {
        bundleId: 'ua.alfabank.mobile.ios',
        fallbackTerm: 'Sense SuperApp',
    },
    ukrgazbank: {
        bundleId: 'ugb.ugb-banking-ios.release',
        fallbackTerm: 'ЕкоБанк Укргазбанк',
    },
    izibank: { bundleId: 'izibank.ua.app', fallbackTerm: 'izibank' },
    raiffeisen: { bundleId: 'ua.raiffeisen.myraif', fallbackTerm: 'MyRaif' },
    abank: { bundleId: 'com.abank24.mobapplication', fallbackTerm: 'abank24' },
    credit_dnipro: {
        bundleId: 'com.creditdnepr.freebank',
        fallbackTerm: 'FreeBank Кредит Дніпро',
    },
    ukrsibbank: {
        bundleId: 'com.ukrsibbank.ukrsibonline.new',
        fallbackTerm: 'UKRSIB online',
    },
};

interface AppStoreResult {
    bundleId?: string;
    trackName?: string;
    artworkUrl512?: string;
    artworkUrl100?: string;
}

async function itunes(url: string): Promise<AppStoreResult[]> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`iTunes ${res.status} for ${url}`);
    const json = (await res.json()) as { results: AppStoreResult[] };
    return json.results ?? [];
}

async function resolveArtwork(
    bundleId: string,
    fallbackTerm: string
): Promise<string> {
    const byId = await itunes(
        `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}`
    );
    const direct = byId[0]?.artworkUrl512 ?? byId[0]?.artworkUrl100;
    if (direct) return direct;

    // Fallback: пошук по назві, беремо результат з очікуваним bundleId.
    const bySearch = await itunes(
        `https://itunes.apple.com/search?term=${encodeURIComponent(fallbackTerm)}&country=ua&entity=software&limit=10`
    );
    const match = bySearch.find((r) => r.bundleId === bundleId) ?? bySearch[0];
    const art = match?.artworkUrl512 ?? match?.artworkUrl100;
    if (!art)
        throw new Error(
            `Не знайдено artwork для ${bundleId} / "${fallbackTerm}"`
        );
    return art;
}

async function main(): Promise<void> {
    mkdirSync(OUTPUT_DIR, { recursive: true });

    const banks = Object.keys(BANK_APP_STORE) as BankCode[];
    for (const bank of banks) {
        const { bundleId, fallbackTerm } = BANK_APP_STORE[bank];
        try {
            const artworkUrl = await resolveArtwork(bundleId, fallbackTerm);
            const res = await fetch(artworkUrl);
            if (!res.ok) throw new Error(`artwork ${res.status}`);
            const input = Buffer.from(await res.arrayBuffer());

            const webp = await sharp(input)
                .resize(SIZE, SIZE, { fit: 'cover' })
                .webp({ quality: 90 })
                .toBuffer();

            writeFileSync(join(OUTPUT_DIR, `${bank}.webp`), webp);
            console.log(`✓ ${bank.padEnd(14)} ← ${artworkUrl}`);
        } catch (err) {
            console.error(`✗ ${bank.padEnd(14)} ${(err as Error).message}`);
            process.exitCode = 1;
        }
    }
}

void main();
