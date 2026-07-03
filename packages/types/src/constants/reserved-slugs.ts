/**
 * Зарезервовані slug-и на корені публічної зони `pay.finly.com.ua/{slug}`.
 *
 * Заборонені для бізнесів. Перевірка живе у генераторі slug-а (Sprint 3);
 * тут — single source of truth для backend і frontend. Вживається у
 * lowercase-нормалізованій формі — slug-генератор перетворює input у
 * lowercase до перевірки.
 *
 * **Категорії** (документ для майбутніх AI-агентів і рев'юверів):
 *
 *  - **TECHNICAL** — технічні роути (Next.js, API, статика). Поломка цих —
 *    зламаний продукт.
 *  - **SYSTEM** — наявні і потенційні сторінки кабінету / лендингу. Зараз
 *    деякі з них живуть тільки на `finly.com.ua`, але список тримаємо
 *    спільний з public-зоною на випадок майбутніх consolidations.
 *  - **GOVERNMENT** — державні структури і чутливі державні бренди.
 *  - **BRANDS** — українські бренди (топ-50). Страховка від squatting + майбутня
 *    воронка VIP-конверсії: при спробі зайняти зарезервований slug ФОП бачить
 *    повідомлення "це ім'я зарезервоване, зверніться до підтримки" — це канал
 *    для sales-розмови з реальним правовласником бренду.
 *  - **PUBLIC_FIGURES** — публічні особи (президенти, провідні політики,
 *    зірки культури і ЗСУ). Список свідомо вузький — широке трактування
 *    "публічної особи" створює юридичну сіру зону. Розширюємо точково по
 *    запиту або інциденту.
 *
 * **Не в цьому файлі:**
 *  - Нецензурщина і офенсивні слова — окремий файл з leetspeak-варіантами,
 *    своєю модерацією, ймовірно imported open-source списком.
 *  - Бізнесові правила VIP-конверсії — це process / sales, не constant.
 *
 * **Як розширювати:** додавати у відповідну категорію + commit. Без міграцій
 * (перевірка at write-time, не DB constraint). Категорії можуть рости
 * незалежно. При додаванні бренду — додавати усі типові варіанти написання
 * (з і без дефіса, абревіатури).
 *
 * **Джерела рішень:**
 *  - `docs/product/qr-decisions.md` §4.3 — публічна URL-зона і базовий список
 *    (5 початкових технічних slug-ів зі Sprint 1).
 *  - `docs/sprints/03-cabinet-public/planning-questions.md` пункт C3 —
 *    розширення до 5 категорій з VIP-конверсійною логікою (Sprint 3).
 */

const TECHNICAL = [
    'qr',
    'api',
    'static',
    '_next',
    '_health',
    'www',
    'mail',
    'ftp',
    'cdn',
    'app',
    'assets',
    'public',
    // Sprint 3 §3.1 — internal URL-segment під middleware-rewrite публічної
    // зони (`app/host-pay/[slug]/page.tsx`). Якщо ФОП візьме slug `host-pay`,
    // public-handler потрапить у рекурсивний rewrite. Reserved тут блокує
    // створення такого slug-а на write-path.
    'host-pay',
] as const;

const SYSTEM = [
    'admin',
    'dashboard',
    'profile',
    'billing',
    'auth',
    'account',
    'settings',
    'login',
    'signin',
    'signup',
    'register',
    'logout',
    'support',
    'help',
    'contact',
    'about',
    'blog',
    'terms',
    'privacy',
    'business',
    'businesses',
    'invoice',
    'invoices',
    'pay',
    'payment',
    'payments',
    'home',
    'index',
    'docs',
    'pricing',
    'features',
    'team',
    'careers',
    'press',
    'finly',
] as const;

const GOVERNMENT = [
    'nbu',
    'gov',
    'government',
    'ukraine',
    'ukraina',
    'official',
    'prezident',
    'president',
    'mvs',
    'sbu',
    'dps',
    'mzs',
    'minfin',
    'rada',
    'kmu',
    'diia',
    'diya',
] as const;

const BRANDS = [
    // Ритейл
    'atb',
    'silpo',
    'novus',
    'fozzy',
    'metro',
    'auchan',
    'ashan',
    'eko-market',
    'ekomarket',

    // E-commerce
    'rozetka',
    'prom',
    'makeup',
    'eva',
    'comfy',
    'foxtrot',
    'allo',
    'citrus',
    'epitsentr',
    'epicentr',
    'epicentre',
    'watsons',
    'lcwaikiki',

    // Fast food / їжа
    'mcdonalds',
    'kfc',
    'dominos',
    'puzata-hata',
    'puzatahata',
    'aroma-kava',
    'aromakava',
    'lviv-croissants',
    'lvivcroissants',

    // Банки (поза MVP_BANKS — щоб і їх не зайняли під видом ФОП)
    'pravex',
    'kredobank',
    'otp',
    'tas',
    'tascombank',
    'concord',
    'ideabank',
    'bankalliance',

    // Телеком
    'kievstar',
    'kyivstar',
    'vodafone',
    'lifecell',
    'datagroup',
    'volia',
    'ukrtelecom',

    // Логістика / пошта
    'novaposhta',
    'nova-poshta',
    'np',
    'ukrposhta',
    'ukr-poshta',
    'meest',
    'justin',

    // АЗС
    'wog',
    'okko',
    'socar',
    'shell',
    'brsm',
    'klo',

    // Аптеки
    'apteka911',
    'apteka-911',
    'podorozhnyk',
    'podorojnik',
    'bazhayemo-zdorovya',
    'tas-apteka',

    // Цифрові сервіси / Fintech
    'privat24',
    'send',
    'sendmono',

    // IT (великі компанії)
    'epam',
    'softserve',
    'globallogic',
    'luxoft',
    'ciklum',
    'dataart',
    'sigma',

    // Медіа
    '1plus1',
    'ictv',
    'stb',
    'inter',
    'pryamy',
    'espreso',
    'hromadske',
    'suspilne',
    'pravda',
    'liga',
    'censor',

    // Соцмережі / месенджери (захист від фейкових офіційних сторінок)
    'telegram',
    'tg',
    'viber',
    'whatsapp',
    'facebook',
    'fb',
    'instagram',
    'insta',
    'ig',
    'youtube',
    'yt',
    'tiktok',
    'twitter',
    'x',

    // Спортивні клуби
    'dynamo',
    'dynamo-kyiv',
    'shakhtar',
    'shakhtar-donetsk',

    // Volunteer-фонди (часто публічні платежі)
    'prytula',
    'serhiyprytula',
    'come-back-alive',
    'comebackalive',
    'united24',
    'u24',
] as const;

const PUBLIC_FIGURES = [
    // Президенти (чинний і нещодавні)
    'zelensky',
    'zelenskyy',
    'zelenskiy',
    'poroshenko',
    'yanukovych',
    'yushchenko',
    'kuchma',
    'kravchuk',

    // Ключові політики (на момент створення списку — 2026)
    'yermak',
    'kuleba',
    'klitschko',
    'klychko',
    'danilov',
    'reznikov',

    // Військове керівництво
    'zaluzhnyy',
    'zaluznyi',
    'syrskyi',
    'syrsky',
    'budanov',

    // Зірки культури / шоу-бізу
    'monatik',
    'vakarchuk',
    'okean-elzy',
    'okeanelzy',
    'dorofeeva',
    'dzidzio',
    'kamenskykh',
] as const;

/**
 * Об'єднаний список усіх зарезервованих slug-ів. Single source of truth для
 * перевірки в slug-генераторі. Lowercase-нормалізований; slug-вхід порівнюється
 * у lowercase.
 */
export const RESERVED_SLUGS = [
    ...TECHNICAL,
    ...SYSTEM,
    ...GOVERNMENT,
    ...BRANDS,
    ...PUBLIC_FIGURES,
] as const;

export type ReservedSlug = (typeof RESERVED_SLUGS)[number];

/**
 * Категорійні експорти — для UI / тестів / майбутніх admin-tooling, де треба
 * розрізнити "це наша системна сторінка" від "це VIP-бренд".
 */
export const RESERVED_SLUGS_BY_CATEGORY = {
    technical: TECHNICAL,
    system: SYSTEM,
    government: GOVERNMENT,
    brands: BRANDS,
    publicFigures: PUBLIC_FIGURES,
} as const;
