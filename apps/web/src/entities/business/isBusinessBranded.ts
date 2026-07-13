/**
 * Sprint 27 — гейтинг бренд-фіч (vanity-slug, логотип) переїхав з рівня
 * користувача на рівень бізнесу. Бізнес брендований, коли прикріплений хоча б до
 * одного активного Бренд-складу платника — це тримає денормалізований прапор
 * `Business.brandedAt` (бекенд-реконсиляція per-business). Web читає саме його,
 * а не рівень користувача (рівнів none/brand/bookkeeper більше немає).
 */
export function isBusinessBranded(
    business: { brandedAt: Date | string | null } | null | undefined
): boolean {
    return business?.brandedAt != null;
}
