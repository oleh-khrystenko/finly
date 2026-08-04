// Продуктовий тюнінг авторизації: однаковий в усіх середовищах, тому живе у
// коді. У `.env` лишається тільки те, що середовища справді розрізняє —
// секрети, адреси хостів, підключення (див. `env.ts`).

export interface LockoutThreshold {
    /** Кількість невдалих спроб, з якої діє цей поріг. */
    attempts: number;
    /** На скільки хвилин блокуємо після досягнення порогу. */
    blockMin: number;
}

/**
 * Сходинки локауту невдалих спроб пароля — спільні для входу і для
 * підтвердження паролем у кабінеті. Порядок за зростанням `attempts`:
 * `resolveActiveLockout` шукає найвищий перевищений поріг з кінця списку.
 */
export const LOGIN_LOCKOUT_THRESHOLDS: readonly LockoutThreshold[] = [
    { attempts: 5, blockMin: 1 },
    { attempts: 10, blockMin: 5 },
    { attempts: 20, blockMin: 15 },
];

/** Скільки хвилин живе лічильник невдалих спроб (sliding-вікно). */
export const LOGIN_ATTEMPTS_TTL_MIN = 15;

export const MAGIC_LINK_LIMITS = {
    /** Скільки хвилин дійсне посилання з листа. */
    ttlMin: 15,
    /** Скільки листів на адресу дозволено у вікні `rateWindowMin`. */
    rateLimit: 3,
    rateWindowMin: 15,
    /**
     * Вікно, у якому повторний запит не шле другий лист, а тихо перезаписує
     * дані вже надісланого token-а (dedup-overwrite).
     */
    dedupSec: 60,
} as const;

/**
 * Інваріант dedup-overwrite-flow (`sendMagicLink`): magic-record мусить жити
 * щонайменше стільки ж, скільки dedup-ключ. При інверсії dedup-ключ переживе
 * запис, `redis.get('magic:<token>')` поверне null, і замість тихого перезапису
 * піде новий лист — anti-spam інваріант зламано.
 */
export function validateMagicLinkTtl(ttlMin: number, dedupSec: number): void {
    if (ttlMin * 60 < dedupSec) {
        throw new Error(
            `❌ MAGIC_LINK_LIMITS.dedupSec (${dedupSec}s) must not exceed MAGIC_LINK_LIMITS.ttlMin ` +
                `converted to seconds (${ttlMin}min = ${ttlMin * 60}s). ` +
                'Otherwise dedup-key outlives magic-record and overwrite-flow breaks.'
        );
    }
}

validateMagicLinkTtl(MAGIC_LINK_LIMITS.ttlMin, MAGIC_LINK_LIMITS.dedupSec);
